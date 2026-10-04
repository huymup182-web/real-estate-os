import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import type { CreateShareLinkDto } from './dto/create-share-link.dto.js';
import { type Actor, PropertiesService, type PropertyScopes } from './properties.service.js';
import { PropertyImagesService, type SharedImageResponse } from './property-images.service.js';
import {
  DEFAULT_SHARE_LINK_DAYS,
  generateShareToken,
  hashShareToken,
  SHARE_TOKEN_PATTERN,
} from './property-share-links.values.js';

/** Link chia sẻ trả cho người tạo; `token` chỉ có ở lần tạo, sau đó không xem lại được. */
export interface CreatedShareLinkResponse {
  id: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
}

/** Link chia sẻ trong danh sách quản lý (không có token). */
export interface ShareLinkResponse {
  id: string;
  createdBy: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  viewCount: number;
  active: boolean;
  createdAt: Date;
}

/**
 * Trang BĐS khách xem qua link. Không có chủ nhà, địa chỉ chi tiết, toạ độ, hoa hồng, ghi chú nội bộ;
 * liên hệ là môi giới đã tạo link.
 */
export interface SharedPropertyResponse {
  code: string;
  title: string;
  description: string | null;
  propertyType: string;
  transactionType: string;
  status: string;
  price: number;
  area: number;
  pricePerM2: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floors: number | null;
  direction: string | null;
  roadWidth: number | null;
  roadAccess: string | null;
  legalStatus: string | null;
  provinceName: string;
  districtName: string | null;
  wardName: string;
  images: SharedImageResponse[];
  agent: { fullName: string; phone: string | null; email: string | null };
  expiresAt: Date;
}

interface ShareLinkRow {
  id: string;
  created_by: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  view_count: number;
  created_at: Date;
}

interface SharedPropertyRow {
  tenant_id: string;
  property_id: string;
  expires_at: Date;
  code: string;
  title: string;
  description: string | null;
  property_type: string;
  transaction_type: string;
  status: string;
  price: string;
  area: string;
  price_per_m2: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floors: number | null;
  direction: string | null;
  road_width: string | null;
  road_access: string | null;
  legal_status: string | null;
  province_name: string;
  district_name: string | null;
  ward_name: string;
  agent_name: string;
  agent_phone: string | null;
  agent_email: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SHARED_NOT_FOUND = 'Link chia sẻ không tồn tại hoặc đã hết hạn';

function toNumberOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/**
 * Link chia sẻ BĐS cho khách (TASK-061, phương án "Link cho khách").
 * - Ai xem được BĐS (`property.view`) thì tạo được link cho mình; BĐS đang ẩn (HIDDEN) không chia sẻ được.
 * - Người sửa được BĐS thấy và thu hồi được mọi link của BĐS; người khác chỉ link của mình.
 * - Khách mở link không cần đăng nhập. Link hết hạn, bị thu hồi, BĐS đã xoá hoặc ẩn, công ty tạm dừng,
 *   người tạo link không còn hoạt động → 404 như link không tồn tại.
 */
@Injectable()
export class PropertyShareLinksService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly properties: PropertiesService,
    private readonly images: PropertyImagesService,
  ) {}

  async create(
    actor: Actor,
    propertyId: string,
    dto: CreateShareLinkDto,
    scopes: PropertyScopes,
  ): Promise<CreatedShareLinkResponse> {
    await this.properties.assertVisible(actor, propertyId, scopes);
    const [property] = (await this.dataSource.query(
      `SELECT status FROM properties WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, propertyId],
    )) as { status: string }[];
    if (property?.status === 'HIDDEN') {
      throw new AppException(ErrorCode.BUSINESS_RULE_VIOLATION, 'BĐS đang ẩn, không chia sẻ được');
    }
    const token = generateShareToken();
    const days = dto.expiresInDays ?? DEFAULT_SHARE_LINK_DAYS;
    const row = await this.dataSource.transaction(async (manager) => {
      const [inserted] = (await manager.query(
        `INSERT INTO property_share_links (tenant_id, property_id, token_hash, created_by, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, expires_at, created_at`,
        [
          actor.tenantId,
          propertyId,
          hashShareToken(token),
          actor.userId,
          new Date(Date.now() + days * DAY_MS),
        ],
      )) as { id: string; expires_at: Date; created_at: Date }[];
      if (!inserted) {
        throw new AppException(ErrorCode.INTERNAL_ERROR);
      }
      await this.properties.recordActivity(
        manager,
        actor,
        propertyId,
        'property.create_share_link',
        {
          shareLinkId: [null, inserted.id],
        },
      );
      return inserted;
    });
    return { id: row.id, token, expiresAt: row.expires_at, createdAt: row.created_at };
  }

  /** Link của BĐS, mới trước: người sửa được BĐS thấy tất cả, người khác chỉ link mình tạo. */
  async findAll(
    actor: Actor,
    propertyId: string,
    scopes: PropertyScopes,
  ): Promise<ShareLinkResponse[]> {
    const { edit } = await this.properties.scopeFlags(actor, propertyId, scopes, {
      edit: scopes.edit,
    });
    const rows = (await this.dataSource.query(
      `SELECT id, created_by, expires_at, revoked_at, view_count, created_at
         FROM property_share_links
        WHERE tenant_id = $1 AND property_id = $2 AND ($3 OR created_by = $4)
        ORDER BY created_at DESC, id DESC`,
      [actor.tenantId, propertyId, edit, actor.userId],
    )) as ShareLinkRow[];
    const now = Date.now();
    return rows.map((row) => ({
      id: row.id,
      createdBy: row.created_by,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      viewCount: row.view_count,
      active: row.revoked_at === null && row.expires_at.getTime() > now,
      createdAt: row.created_at,
    }));
  }

  /** Thu hồi link → 204 (gọi lại khi đã thu hồi cũng 204). Người tạo link hoặc người sửa được BĐS. */
  async revoke(
    actor: Actor,
    propertyId: string,
    linkId: string,
    scopes: PropertyScopes,
  ): Promise<void> {
    const { edit } = await this.properties.scopeFlags(actor, propertyId, scopes, {
      edit: scopes.edit,
    });
    const [link] = (await this.dataSource.query(
      `SELECT created_by FROM property_share_links
        WHERE tenant_id = $1 AND property_id = $2 AND id = $3`,
      [actor.tenantId, propertyId, linkId],
    )) as { created_by: string | null }[];
    if (!link) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Không tìm thấy link chia sẻ');
    }
    if (!edit && link.created_by !== actor.userId) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Không có quyền thu hồi link chia sẻ này');
    }
    await this.dataSource.transaction(async (manager) => {
      const [, revoked] = (await manager.query(
        `UPDATE property_share_links SET revoked_at = now()
          WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL`,
        [actor.tenantId, linkId],
      )) as [unknown, number];
      if (revoked > 0) {
        await this.properties.recordActivity(
          manager,
          actor,
          propertyId,
          'property.revoke_share_link',
          { shareLinkId: [linkId, null] },
        );
      }
    });
  }

  /** Khách mở link: trả thông tin BĐS giới hạn và tăng lượt xem của link. */
  async findShared(token: string): Promise<SharedPropertyResponse> {
    if (!SHARE_TOKEN_PATTERN.test(token)) {
      throw new AppException(ErrorCode.NOT_FOUND, SHARED_NOT_FOUND);
    }
    const [row] = (await this.dataSource.query(
      `WITH link AS (
         UPDATE property_share_links l
            SET view_count = l.view_count + 1
           FROM properties p, companies c, users u
          WHERE l.token_hash = $1 AND l.revoked_at IS NULL AND l.expires_at > now()
            AND p.tenant_id = l.tenant_id AND p.id = l.property_id
            AND p.deleted_at IS NULL AND p.status <> 'HIDDEN'
            AND c.id = l.tenant_id AND c.deleted_at IS NULL AND c.status = 'ACTIVE'
            AND u.tenant_id = l.tenant_id AND u.id = l.created_by
            AND u.deleted_at IS NULL AND u.status = 'ACTIVE'
         RETURNING l.tenant_id, l.property_id, l.created_by, l.expires_at
       )
       SELECT link.tenant_id, link.property_id, link.expires_at,
              p.code, p.title, p.description, p.property_type, p.transaction_type, p.status,
              p.price, p.area, p.price_per_m2, p.bedrooms, p.bathrooms, p.floors, p.direction,
              p.road_width, p.road_access, p.legal_status,
              pr.name AS province_name, d.name AS district_name, w.name AS ward_name,
              u.full_name AS agent_name, u.phone AS agent_phone, u.email AS agent_email
         FROM link
         JOIN properties p ON p.tenant_id = link.tenant_id AND p.id = link.property_id
         JOIN provinces pr ON pr.id = p.province_id
         JOIN wards w ON w.id = p.ward_id
         LEFT JOIN districts d ON d.id = p.district_id
         JOIN users u ON u.tenant_id = link.tenant_id AND u.id = link.created_by`,
      [hashShareToken(token)],
    )) as SharedPropertyRow[];
    if (!row) {
      throw new AppException(ErrorCode.NOT_FOUND, SHARED_NOT_FOUND);
    }
    return {
      code: row.code,
      title: row.title,
      description: row.description,
      propertyType: row.property_type,
      transactionType: row.transaction_type,
      status: row.status,
      price: Number(row.price),
      area: Number(row.area),
      pricePerM2: toNumberOrNull(row.price_per_m2),
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      floors: row.floors,
      direction: row.direction,
      roadWidth: toNumberOrNull(row.road_width),
      roadAccess: row.road_access,
      legalStatus: row.legal_status,
      provinceName: row.province_name,
      districtName: row.district_name,
      wardName: row.ward_name,
      images: await this.images.findShared(row.tenant_id, row.property_id),
      agent: { fullName: row.agent_name, phone: row.agent_phone, email: row.agent_email },
      expiresAt: row.expires_at,
    };
  }
}
