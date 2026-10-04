import { randomUUID } from 'node:crypto';

import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import sharp from 'sharp';
import { DataSource, type EntityManager } from 'typeorm';

import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { StorageService } from '../storage/storage.service.js';
import type {
  ConfirmImageDto,
  CreateImageUploadDto,
  ReorderImagesDto,
} from './dto/property-image.dto.js';
import { type Actor, PropertiesService, type PropertyScopes } from './properties.service.js';
import {
  type ImageMimeType,
  imageStorageKey,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_PROPERTY,
  THUMBNAIL_MAX_SIZE,
  THUMBNAIL_MIME_TYPE,
  thumbnailStorageKey,
} from './property-images.values.js';

/**
 * Ảnh BĐS trả cho client. `url` là ảnh gốc, `thumbnailUrl` là ảnh nhỏ (null khi chưa tạo xong hoặc không
 * tạo được, vd HEIC); đều là CDN hoặc link có hạn.
 */
export interface PropertyImageResponse {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  sortOrder: number;
  isCover: boolean;
  createdAt: Date;
}

/** Link upload trả cho client: PUT file lên `uploadUrl` kèm `headers`, rồi xác nhận bằng `imageId`. */
export interface ImageUploadResponse {
  imageId: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: Date;
}

interface ImageRow {
  id: string;
  storage_key: string;
  thumbnail_key: string | null;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  sort_order: number;
  is_cover: boolean;
  created_at: Date;
}

const FORBIDDEN_MESSAGE = 'Không có quyền sửa ảnh của BĐS này';

/**
 * Ảnh BĐS (TASK-057). File upload thẳng lên S3/R2 qua link backend cấp; bảng `property_images` chỉ lưu
 * key và thông tin ảnh. Xem ảnh theo quyền xem BĐS; thêm, sắp xếp, đổi ảnh bìa, xoá theo `property.edit`.
 * Mọi thay đổi khoá dòng BĐS nên hai thao tác cùng lúc trên một BĐS không vượt giới hạn 30 ảnh.
 * Thumbnail tạo nền sau khi xác nhận (phase0/02-ARCHITECTURE.md mục 4, Huy Lê duyệt sharp ngày 2026-10-04).
 */
@Injectable()
export class PropertyImagesService implements OnApplicationShutdown {
  private readonly logger = new Logger(PropertyImagesService.name);
  /** Job thumbnail đang chạy (để test và lúc tắt ứng dụng chờ được). */
  private readonly thumbnailJobs = new Set<Promise<void>>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly properties: PropertiesService,
    private readonly storage: StorageService,
  ) {}

  /** Cấp link upload cho một ảnh mới. Chưa ghi gì vào database cho tới khi xác nhận. */
  async createUpload(
    actor: Actor,
    propertyId: string,
    dto: CreateImageUploadDto,
    scopes: PropertyScopes,
  ): Promise<ImageUploadResponse> {
    await this.dataSource.transaction(async (manager) => {
      await this.properties.lockEditable(manager, actor, propertyId, scopes, FORBIDDEN_MESSAGE);
      await this.assertBelowLimit(manager, actor.tenantId, propertyId);
    });
    const imageId = randomUUID();
    const upload = await this.storage.createUploadUrl(
      imageStorageKey(actor.tenantId, propertyId, imageId, dto.mimeType),
      dto.mimeType,
    );
    return { imageId, uploadUrl: upload.url, headers: upload.headers, expiresAt: upload.expiresAt };
  }

  /**
   * Ghi ảnh đã upload vào BĐS. File phải có trên storage, đúng định dạng đã khai báo, tối đa 10MB
   * (không thì 422). Ảnh đầu tiên của BĐS là ảnh bìa; ảnh mới xếp cuối.
   */
  async confirm(
    actor: Actor,
    propertyId: string,
    dto: ConfirmImageDto,
    scopes: PropertyScopes,
  ): Promise<PropertyImageResponse> {
    const key = imageStorageKey(actor.tenantId, propertyId, dto.imageId, dto.mimeType);
    const row = await this.dataSource.transaction(async (manager) => {
      await this.properties.lockEditable(manager, actor, propertyId, scopes, FORBIDDEN_MESSAGE);
      const [existing] = (await manager.query(
        'SELECT 1 FROM property_images WHERE storage_key = $1',
        [key],
      )) as unknown[];
      if (existing) {
        throw new AppException(ErrorCode.CONFLICT, 'Ảnh này đã được xác nhận');
      }
      await this.assertBelowLimit(manager, actor.tenantId, propertyId);
      const sizeBytes = await this.assertUploaded(key, dto.mimeType);

      const [inserted] = (await manager.query(
        `INSERT INTO property_images
           (id, tenant_id, property_id, storage_key, mime_type, size_bytes, width, height,
            sort_order, is_cover, created_by)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8,
                COALESCE(MAX(sort_order) + 1, 0), COUNT(*) FILTER (WHERE is_cover) = 0, $9
           FROM property_images
          WHERE tenant_id = $2 AND property_id = $3 AND deleted_at IS NULL
         RETURNING *`,
        [
          dto.imageId,
          actor.tenantId,
          propertyId,
          key,
          dto.mimeType,
          sizeBytes,
          dto.width ?? null,
          dto.height ?? null,
          actor.userId,
        ],
      )) as ImageRow[];
      return inserted;
    });
    if (!row) {
      throw new AppException(ErrorCode.INTERNAL_ERROR);
    }
    this.scheduleThumbnail(actor.tenantId, row);
    return this.toResponse(row);
  }

  /** Chờ các job thumbnail đang chạy xong. */
  async waitForThumbnails(): Promise<void> {
    await Promise.all([...this.thumbnailJobs]);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.waitForThumbnails();
  }

  /** Tạo thumbnail nền; lỗi chỉ ghi log, ảnh vẫn dùng được với `thumbnailUrl = null`. */
  private scheduleThumbnail(tenantId: string, image: ImageRow): void {
    const job = this.createThumbnail(tenantId, image)
      .catch((error: unknown) => {
        this.logger.warn('Không tạo được thumbnail', {
          imageId: image.id,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => this.thumbnailJobs.delete(job));
    this.thumbnailJobs.add(job);
  }

  private async createThumbnail(tenantId: string, image: ImageRow): Promise<void> {
    const original = await this.storage.getObject(image.storage_key);
    const thumbnail = await sharp(original)
      .rotate()
      .resize({
        width: THUMBNAIL_MAX_SIZE,
        height: THUMBNAIL_MAX_SIZE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();
    const key = thumbnailStorageKey(image.storage_key);
    await this.storage.putObject(key, thumbnail, THUMBNAIL_MIME_TYPE);
    await this.dataSource.query(
      `UPDATE property_images SET thumbnail_key = $3
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, image.id, key],
    );
  }

  /** Ảnh của BĐS xem được, theo thứ tự hiển thị. */
  async findAll(
    actor: Actor,
    propertyId: string,
    scopes: PropertyScopes,
  ): Promise<PropertyImageResponse[]> {
    await this.properties.assertVisible(actor, propertyId, scopes);
    return this.list(this.dataSource.manager, actor.tenantId, propertyId);
  }

  /** Đặt lại thứ tự: `imageIds` phải đúng toàn bộ ảnh đang có của BĐS (không thì 400). */
  async reorder(
    actor: Actor,
    propertyId: string,
    dto: ReorderImagesDto,
    scopes: PropertyScopes,
  ): Promise<PropertyImageResponse[]> {
    return this.dataSource.transaction(async (manager) => {
      await this.properties.lockEditable(manager, actor, propertyId, scopes, FORBIDDEN_MESSAGE);
      const current = await this.rows(manager, actor.tenantId, propertyId);
      const currentIds = new Set(current.map((image) => image.id));
      if (
        dto.imageIds.length !== currentIds.size ||
        dto.imageIds.some((imageId) => !currentIds.has(imageId))
      ) {
        throw new AppException(ErrorCode.VALIDATION_ERROR, undefined, [
          { field: 'imageIds', message: 'imageIds phải gồm đúng toàn bộ ảnh hiện có của BĐS' },
        ]);
      }
      await manager.query(
        `UPDATE property_images i
            SET sort_order = o.position - 1
           FROM unnest($3::uuid[]) WITH ORDINALITY AS o(id, position)
          WHERE i.id = o.id AND i.tenant_id = $1 AND i.property_id = $2 AND i.deleted_at IS NULL`,
        [actor.tenantId, propertyId, dto.imageIds],
      );
      return this.list(manager, actor.tenantId, propertyId);
    });
  }

  /** Chọn ảnh bìa (mỗi BĐS một ảnh bìa). */
  async setCover(
    actor: Actor,
    propertyId: string,
    imageId: string,
    scopes: PropertyScopes,
  ): Promise<PropertyImageResponse[]> {
    return this.dataSource.transaction(async (manager) => {
      await this.properties.lockEditable(manager, actor, propertyId, scopes, FORBIDDEN_MESSAGE);
      await this.findImage(manager, actor.tenantId, propertyId, imageId);
      await manager.query(
        `UPDATE property_images SET is_cover = false
          WHERE tenant_id = $1 AND property_id = $2 AND is_cover AND deleted_at IS NULL`,
        [actor.tenantId, propertyId],
      );
      await manager.query(
        `UPDATE property_images SET is_cover = true WHERE tenant_id = $1 AND id = $2`,
        [actor.tenantId, imageId],
      );
      return this.list(manager, actor.tenantId, propertyId);
    });
  }

  /**
   * Xoá mềm ảnh (file trên storage giữ nguyên). Xoá ảnh bìa thì ảnh đầu tiên còn lại thành ảnh bìa.
   */
  async remove(
    actor: Actor,
    propertyId: string,
    imageId: string,
    scopes: PropertyScopes,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.properties.lockEditable(manager, actor, propertyId, scopes, FORBIDDEN_MESSAGE);
      const image = await this.findImage(manager, actor.tenantId, propertyId, imageId);
      await manager.query(
        `UPDATE property_images SET deleted_at = now(), is_cover = false
          WHERE tenant_id = $1 AND id = $2`,
        [actor.tenantId, imageId],
      );
      if (image.is_cover) {
        await manager.query(
          `UPDATE property_images SET is_cover = true
            WHERE id = (SELECT id FROM property_images
                         WHERE tenant_id = $1 AND property_id = $2 AND deleted_at IS NULL
                         ORDER BY sort_order, created_at, id LIMIT 1)`,
          [actor.tenantId, propertyId],
        );
      }
    });
  }

  private async assertBelowLimit(
    manager: EntityManager,
    tenantId: string,
    propertyId: string,
  ): Promise<void> {
    const [row] = (await manager.query(
      `SELECT COUNT(*)::int AS count FROM property_images
        WHERE tenant_id = $1 AND property_id = $2 AND deleted_at IS NULL`,
      [tenantId, propertyId],
    )) as { count: number }[];
    if ((row?.count ?? 0) >= MAX_IMAGES_PER_PROPERTY) {
      throw new AppException(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        `Mỗi BĐS tối đa ${MAX_IMAGES_PER_PROPERTY} ảnh`,
      );
    }
  }

  /** File phải có trên storage, đúng định dạng, không quá 10MB. Trả về kích thước thật. */
  private async assertUploaded(key: string, mimeType: ImageMimeType): Promise<number> {
    const stored = await this.storage.head(key);
    if (!stored) {
      throw new AppException(ErrorCode.BUSINESS_RULE_VIOLATION, 'Chưa upload file ảnh');
    }
    if (stored.contentType !== mimeType) {
      throw new AppException(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        'File đã upload không đúng định dạng đã khai báo',
      );
    }
    if (stored.sizeBytes < 1 || stored.sizeBytes > MAX_IMAGE_BYTES) {
      throw new AppException(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        `Ảnh tối đa ${MAX_IMAGE_BYTES / 1024 / 1024}MB`,
      );
    }
    return stored.sizeBytes;
  }

  private async findImage(
    manager: EntityManager,
    tenantId: string,
    propertyId: string,
    imageId: string,
  ): Promise<ImageRow> {
    const [image] = (await manager.query(
      `SELECT * FROM property_images
        WHERE tenant_id = $1 AND property_id = $2 AND id = $3 AND deleted_at IS NULL`,
      [tenantId, propertyId, imageId],
    )) as ImageRow[];
    if (!image) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Không tìm thấy ảnh');
    }
    return image;
  }

  private rows(manager: EntityManager, tenantId: string, propertyId: string): Promise<ImageRow[]> {
    return manager.query(
      `SELECT * FROM property_images
        WHERE tenant_id = $1 AND property_id = $2 AND deleted_at IS NULL
        ORDER BY sort_order, created_at, id`,
      [tenantId, propertyId],
    ) as Promise<ImageRow[]>;
  }

  private async list(
    manager: EntityManager,
    tenantId: string,
    propertyId: string,
  ): Promise<PropertyImageResponse[]> {
    const rows = await this.rows(manager, tenantId, propertyId);
    return Promise.all(rows.map((row) => this.toResponse(row)));
  }

  private async toResponse(row: ImageRow): Promise<PropertyImageResponse> {
    return {
      id: row.id,
      url: await this.storage.readUrl(row.storage_key),
      thumbnailUrl: row.thumbnail_key ? await this.storage.readUrl(row.thumbnail_key) : null,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      width: row.width,
      height: row.height,
      sortOrder: row.sort_order,
      isCover: row.is_cover,
      createdAt: row.created_at,
    };
  }
}
