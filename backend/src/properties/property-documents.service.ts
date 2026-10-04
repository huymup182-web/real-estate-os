import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import type { PermissionScope } from '../auth/permission.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { StorageService } from '../storage/storage.service.js';
import type { ConfirmDocumentDto, CreateDocumentUploadDto } from './dto/property-document.dto.js';
import { type Actor, PropertiesService, type PropertyScopes } from './properties.service.js';
import {
  DOCUMENT_URL_TTL_SECONDS,
  type DocumentType,
  documentStorageKey,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS_PER_PROPERTY,
  OWNER_DOCUMENT_TYPES,
} from './property-documents.values.js';

/** Giấy tờ BĐS trả cho client. `url` là link tải có hạn 5 phút, luôn qua storage (không qua CDN). */
export interface PropertyDocumentResponse {
  id: string;
  documentType: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdBy: string | null;
  createdAt: Date;
}

/** Link upload trả cho client: PUT file lên `uploadUrl` kèm `headers`, rồi xác nhận bằng `documentId`. */
export interface DocumentUploadResponse {
  documentId: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: Date;
}

interface DocumentRow {
  id: string;
  document_type: string;
  file_name: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  created_by: string | null;
  created_at: Date;
}

const VIEW_FORBIDDEN = 'Không có quyền xem giấy tờ của BĐS này';
const EDIT_FORBIDDEN = 'Không có quyền sửa giấy tờ của BĐS này';

/**
 * Giấy tờ pháp lý của BĐS (TASK-058). Upload thẳng lên S3/R2 như ảnh (TASK-057), không tạo thumbnail.
 * - Xem cần `property.view_documents` với BĐS; thêm, xoá cần thêm `property.edit`.
 * - CCCD chủ nhà (OWNER_ID_DOCUMENT) cần thêm `property.view_owner_contact`; người thiếu quyền này không
 *   thấy loại giấy tờ đó trong danh sách.
 * - Không xem được BĐS → 404; xem được nhưng thiếu quyền → 403.
 */
@Injectable()
export class PropertyDocumentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly properties: PropertiesService,
    private readonly storage: StorageService,
  ) {}

  /** Cấp link upload cho một giấy tờ mới. Chưa ghi gì vào database cho tới khi xác nhận. */
  async createUpload(
    actor: Actor,
    propertyId: string,
    dto: CreateDocumentUploadDto,
    scopes: PropertyScopes,
  ): Promise<DocumentUploadResponse> {
    await this.dataSource.transaction(async (manager) => {
      await this.lockForChange(manager, actor, propertyId, scopes, dto.documentType);
      await this.assertBelowLimit(manager, actor.tenantId, propertyId);
    });
    const documentId = randomUUID();
    const upload = await this.storage.createUploadUrl(
      documentStorageKey(actor.tenantId, propertyId, documentId, dto.mimeType),
      dto.mimeType,
    );
    return {
      documentId,
      uploadUrl: upload.url,
      headers: upload.headers,
      expiresAt: upload.expiresAt,
    };
  }

  /** Ghi giấy tờ đã upload. File phải có trên storage, đúng định dạng, tối đa 10MB (không thì 422). */
  async confirm(
    actor: Actor,
    propertyId: string,
    dto: ConfirmDocumentDto,
    scopes: PropertyScopes,
  ): Promise<PropertyDocumentResponse> {
    const key = documentStorageKey(actor.tenantId, propertyId, dto.documentId, dto.mimeType);
    const row = await this.dataSource.transaction(async (manager) => {
      await this.lockForChange(manager, actor, propertyId, scopes, dto.documentType);
      const [existing] = (await manager.query(
        'SELECT 1 FROM property_documents WHERE storage_key = $1',
        [key],
      )) as unknown[];
      if (existing) {
        throw new AppException(ErrorCode.CONFLICT, 'Giấy tờ này đã được xác nhận');
      }
      await this.assertBelowLimit(manager, actor.tenantId, propertyId);
      const sizeBytes = await this.assertUploaded(key, dto.mimeType);
      const [inserted] = (await manager.query(
        `INSERT INTO property_documents
           (id, tenant_id, property_id, document_type, file_name, storage_key, mime_type, size_bytes,
            created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          dto.documentId,
          actor.tenantId,
          propertyId,
          dto.documentType,
          dto.fileName,
          key,
          dto.mimeType,
          sizeBytes,
          actor.userId,
        ],
      )) as DocumentRow[];
      return inserted;
    });
    if (!row) {
      throw new AppException(ErrorCode.INTERNAL_ERROR);
    }
    return this.toResponse(row);
  }

  /** Giấy tờ của BĐS, mới trước; ẩn CCCD chủ nhà với người không xem được liên hệ chủ nhà. */
  async findAll(
    actor: Actor,
    propertyId: string,
    scopes: PropertyScopes,
  ): Promise<PropertyDocumentResponse[]> {
    const flags = await this.properties.scopeFlags(actor, propertyId, scopes, {
      documents: scopes.documents,
      contact: scopes.contact,
    });
    if (!flags.documents) {
      throw new AppException(ErrorCode.FORBIDDEN, VIEW_FORBIDDEN);
    }
    const rows = (await this.dataSource.query(
      `SELECT * FROM property_documents
        WHERE tenant_id = $1 AND property_id = $2 AND deleted_at IS NULL
          AND ($3 OR NOT (document_type = ANY($4::text[])))
        ORDER BY created_at DESC, id DESC`,
      [actor.tenantId, propertyId, flags.contact, OWNER_DOCUMENT_TYPES],
    )) as DocumentRow[];
    return Promise.all(rows.map((row) => this.toResponse(row)));
  }

  /**
   * Xoá mềm giấy tờ → 204 (file giữ trên storage). CCCD chủ nhà với người không xem được liên hệ chủ nhà
   * coi như không tồn tại (404), giống danh sách.
   */
  async remove(
    actor: Actor,
    propertyId: string,
    documentId: string,
    scopes: PropertyScopes,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.lockForChange(manager, actor, propertyId, scopes);
      const { contact } = await this.properties.scopeFlags(actor, propertyId, scopes, {
        contact: scopes.contact,
      });
      const [document] = (await manager.query(
        `SELECT id FROM property_documents
          WHERE tenant_id = $1 AND property_id = $2 AND id = $3 AND deleted_at IS NULL
            AND ($4 OR NOT (document_type = ANY($5::text[])))`,
        [actor.tenantId, propertyId, documentId, contact, OWNER_DOCUMENT_TYPES],
      )) as unknown[];
      if (!document) {
        throw new AppException(ErrorCode.NOT_FOUND, 'Không tìm thấy giấy tờ');
      }
      await manager.query(
        `UPDATE property_documents SET deleted_at = now() WHERE tenant_id = $1 AND id = $2`,
        [actor.tenantId, documentId],
      );
    });
  }

  /** Khoá BĐS để thêm/xoá giấy tờ: cần `property.edit`, `property.view_documents` (và liên hệ chủ nhà). */
  private async lockForChange(
    manager: EntityManager,
    actor: Actor,
    propertyId: string,
    scopes: PropertyScopes,
    documentType?: DocumentType,
  ): Promise<void> {
    const extra: (PermissionScope | undefined)[] = [scopes.documents];
    if (documentType && OWNER_DOCUMENT_TYPES.includes(documentType)) {
      extra.push(scopes.contact);
    }
    await this.properties.lockEditable(manager, actor, propertyId, scopes, EDIT_FORBIDDEN, extra);
  }

  private async assertBelowLimit(
    manager: EntityManager,
    tenantId: string,
    propertyId: string,
  ): Promise<void> {
    const [row] = (await manager.query(
      `SELECT COUNT(*)::int AS count FROM property_documents
        WHERE tenant_id = $1 AND property_id = $2 AND deleted_at IS NULL`,
      [tenantId, propertyId],
    )) as { count: number }[];
    if ((row?.count ?? 0) >= MAX_DOCUMENTS_PER_PROPERTY) {
      throw new AppException(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        `Mỗi BĐS tối đa ${MAX_DOCUMENTS_PER_PROPERTY} giấy tờ`,
      );
    }
  }

  private async assertUploaded(key: string, mimeType: string): Promise<number> {
    const stored = await this.storage.head(key);
    if (!stored) {
      throw new AppException(ErrorCode.BUSINESS_RULE_VIOLATION, 'Chưa upload file giấy tờ');
    }
    if (stored.contentType !== mimeType) {
      throw new AppException(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        'File đã upload không đúng định dạng đã khai báo',
      );
    }
    if (stored.sizeBytes < 1 || stored.sizeBytes > MAX_DOCUMENT_BYTES) {
      throw new AppException(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        `Giấy tờ tối đa ${MAX_DOCUMENT_BYTES / 1024 / 1024}MB`,
      );
    }
    return stored.sizeBytes;
  }

  private async toResponse(row: DocumentRow): Promise<PropertyDocumentResponse> {
    return {
      id: row.id,
      documentType: row.document_type,
      fileName: row.file_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      url: await this.storage.signedReadUrl(
        row.storage_key,
        DOCUMENT_URL_TTL_SECONDS,
        row.file_name,
      ),
      createdBy: row.created_by,
      createdAt: row.created_at,
    };
  }
}
