import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository } from 'typeorm';

import { AppException, type ErrorDetail } from '../common/errors/app.exception.js';
import { scopeCondition } from '../auth/record-scope.js';
import type { PermissionScope } from '../auth/permission.service.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { TenantRepository } from '../database/tenant.repository.js';
import type { CreatePropertyDto } from './dto/create-property.dto.js';
import { Property } from './property.entity.js';
import {
  type PropertyDetailResponse,
  type PropertyOwnerContact,
  type PropertyResponse,
  toPropertyDetailResponse,
  toPropertyResponse,
} from './property.response.js';
import { formatPropertyCode } from './property-values.js';

/** Người thực hiện thao tác, lấy từ access token (không bao giờ từ body). */
export interface Actor {
  userId: string;
  tenantId: string;
}

/** Cột xét phạm vi của BĐS: môi giới phụ trách và người tạo. */
const PROPERTY_SCOPE_COLUMNS = { agent: 'p.agent_id', creator: 'p.created_by' };

@Injectable()
export class PropertiesService {
  private readonly properties: TenantRepository<Property>;

  constructor(
    @InjectRepository(Property) repository: Repository<Property>,
    private readonly dataSource: DataSource,
  ) {
    this.properties = new TenantRepository(repository);
  }

  /**
   * Tạo BĐS (TASK-049): người tạo là môi giới phụ trách, trạng thái AVAILABLE, chưa xác minh.
   * Mã BĐS cấp theo bộ đếm của công ty trong cùng transaction với lệnh tạo.
   */
  async create(actor: Actor, dto: CreatePropertyDto): Promise<PropertyResponse> {
    if (dto.commissionType === 'PERCENT' && (dto.commissionValue ?? 0) > 100) {
      throw invalid([{ field: 'commissionValue', message: 'Hoa hồng theo % phải từ 0 đến 100' }]);
    }
    await this.assertLocation(dto);

    const property = await this.dataSource.transaction(async (manager) => {
      const code = formatPropertyCode(await this.nextCodeValue(manager, actor.tenantId));
      return this.properties.withManager(manager).create(actor.tenantId, {
        code,
        title: dto.title,
        description: dto.description ?? null,
        propertyType: dto.propertyType,
        price: dto.price,
        area: dto.area,
        bedrooms: dto.bedrooms ?? null,
        bathrooms: dto.bathrooms ?? null,
        floors: dto.floors ?? null,
        direction: dto.direction ?? null,
        roadWidth: dto.roadWidth ?? null,
        roadAccess: dto.roadAccess ?? null,
        legalStatus: dto.legalStatus ?? null,
        provinceId: dto.provinceId,
        districtId: dto.districtId ?? null,
        wardId: dto.wardId,
        streetAddress: dto.streetAddress ?? null,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        source: dto.source ?? null,
        commissionType: dto.commissionType ?? null,
        commissionValue: dto.commissionValue ?? null,
        agentId: actor.userId,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
    });
    return toPropertyResponse(property);
  }

  /**
   * Chi tiết BĐS (TASK-050). Ngoài phạm vi `property.view` của user, đã xoá hoặc thuộc công ty khác → 404
   * (không lộ BĐS có tồn tại). Địa chỉ chi tiết và chủ nhà chỉ trả khi BĐS nằm trong phạm vi
   * `property.view_owner_contact` của user (phase0/04-RBAC.md, Q5).
   */
  async findOne(
    actor: Actor,
    id: string,
    viewScope: PermissionScope,
    contactScope: PermissionScope | undefined,
  ): Promise<PropertyDetailResponse> {
    const contactVisible = contactScope
      ? scopeCondition(contactScope, PROPERTY_SCOPE_COLUMNS)
      : 'FALSE';
    const { entities, raw } = await this.properties
      .createQueryBuilder(actor.tenantId, 'p', (query) =>
        query
          .where('p.id = :id', { id })
          .andWhere(scopeCondition(viewScope, PROPERTY_SCOPE_COLUMNS)),
      )
      .addSelect(`(${contactVisible})`, 'owner_contact_visible')
      .setParameter('scopeUserId', actor.userId)
      .getRawAndEntities<{ owner_contact_visible: boolean }>();

    const property = entities[0];
    if (!property) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Không tìm thấy BĐS');
    }
    const visible = raw[0]?.owner_contact_visible === true;
    const owner =
      visible && property.ownerId ? await this.findOwner(actor.tenantId, property.ownerId) : null;
    return toPropertyDetailResponse(property, owner, visible);
  }

  private async findOwner(tenantId: string, ownerId: string): Promise<PropertyOwnerContact | null> {
    const [owner] = (await this.dataSource.query(
      `SELECT id, full_name AS "fullName", phone, email
         FROM owners
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, ownerId],
    )) as PropertyOwnerContact[];
    return owner ?? null;
  }

  /** Tỉnh, phường/xã (và quận/huyện nếu có) phải tồn tại, đang dùng và thuộc đúng tỉnh. */
  private async assertLocation(dto: CreatePropertyDto): Promise<void> {
    const [row] = (await this.dataSource.query(
      `SELECT
         EXISTS (SELECT 1 FROM provinces WHERE id = $1 AND is_active) AS province,
         EXISTS (SELECT 1 FROM wards WHERE id = $2 AND province_id = $1 AND is_active) AS ward,
         ($3::uuid IS NULL
           OR EXISTS (SELECT 1 FROM districts WHERE id = $3 AND province_id = $1 AND is_active)
         ) AS district`,
      [dto.provinceId, dto.wardId, dto.districtId ?? null],
    )) as { province: boolean; ward: boolean; district: boolean }[];

    const details: ErrorDetail[] = [];
    if (!row?.province) {
      details.push({ field: 'provinceId', message: 'Tỉnh/thành không tồn tại' });
    } else {
      if (!row.ward) {
        details.push({ field: 'wardId', message: 'Phường/xã không thuộc tỉnh/thành đã chọn' });
      }
      if (!row.district) {
        details.push({
          field: 'districtId',
          message: 'Quận/huyện không thuộc tỉnh/thành đã chọn',
        });
      }
    }
    if (details.length > 0) {
      throw invalid(details);
    }
  }

  /** Tăng bộ đếm mã BĐS của công ty; khoá dòng tới hết transaction nên không cấp trùng số. */
  private async nextCodeValue(manager: EntityManager, tenantId: string): Promise<number> {
    const [row] = (await manager.query(
      `INSERT INTO property_code_counters (tenant_id, last_value) VALUES ($1, 1)
       ON CONFLICT (tenant_id)
         DO UPDATE SET last_value = property_code_counters.last_value + 1
       RETURNING last_value`,
      [tenantId],
    )) as { last_value: string }[];
    return Number(row?.last_value);
  }
}

function invalid(details: ErrorDetail[]): AppException {
  return new AppException(ErrorCode.VALIDATION_ERROR, undefined, details);
}
