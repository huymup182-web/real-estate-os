import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository } from 'typeorm';

import { AppException, type ErrorDetail } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { TenantRepository } from '../database/tenant.repository.js';
import type { CreatePropertyDto } from './dto/create-property.dto.js';
import { Property } from './property.entity.js';
import { toPropertyResponse, type PropertyResponse } from './property.response.js';
import { formatPropertyCode } from './property-values.js';

/** Người thực hiện thao tác, lấy từ access token (không bao giờ từ body). */
export interface Actor {
  userId: string;
  tenantId: string;
}

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
