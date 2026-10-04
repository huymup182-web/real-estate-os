import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository } from 'typeorm';

import { AppException, type ErrorDetail } from '../common/errors/app.exception.js';
import { scopeCondition } from '../auth/record-scope.js';
import type { PermissionScope } from '../auth/permission.service.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { Paginated } from '../common/response/paginated.js';
import type { PaginationQueryDto } from '../common/response/pagination-query.dto.js';
import { TenantRepository, type TenantWritable } from '../database/tenant.repository.js';
import type { CreatePropertyDto } from './dto/create-property.dto.js';
import { EDITABLE_PROPERTY_FIELDS, type UpdatePropertyDto } from './dto/update-property.dto.js';
import { Property } from './property.entity.js';
import {
  type PropertyDetailResponse,
  type PropertyListItem,
  type PropertyOwnerContact,
  type PropertyResponse,
  toPropertyDetailResponse,
  toPropertyListItem,
  toPropertyResponse,
} from './property.response.js';
import { formatPropertyCode } from './property-values.js';

/** Người thực hiện thao tác, lấy từ access token (không bao giờ từ body). */
export interface Actor {
  userId: string;
  tenantId: string;
}

/** Phạm vi quyền của user với BĐS, lấy từ `req.user.permissions`. Không có key = không có quyền. */
export interface PropertyScopes {
  view: PermissionScope | undefined;
  edit: PermissionScope | undefined;
  contact: PermissionScope | undefined;
}

/** Địa giới của BĐS cần kiểm. */
interface LocationInput {
  provinceId: string;
  wardId: string;
  districtId?: string | null;
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
    const { entities, raw } = await this.properties
      .createQueryBuilder(actor.tenantId, 'p', (query) =>
        query
          .where('p.id = :id', { id })
          .andWhere(scopeCondition(viewScope, PROPERTY_SCOPE_COLUMNS)),
      )
      .addSelect(`(${this.contactCondition(contactScope)})`, 'owner_contact_visible')
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

  /**
   * Danh sách BĐS trong phạm vi `property.view` của user (TASK-051), mới tạo trước, phân trang offset.
   * Không gồm BĐS đã xoá mềm. Lọc, tìm kiếm và các kiểu sắp xếp khác làm ở Phase 5 (TASK-064..074).
   */
  async findAll(
    actor: Actor,
    query: PaginationQueryDto,
    viewScope: PermissionScope,
    contactScope: PermissionScope | undefined,
  ): Promise<Paginated<PropertyListItem>> {
    const base = this.properties
      .createQueryBuilder(actor.tenantId, 'p', (builder) =>
        builder.where(scopeCondition(viewScope, PROPERTY_SCOPE_COLUMNS)),
      )
      .setParameter('scopeUserId', actor.userId);

    const total = await base.clone().getCount();
    const { entities, raw } = await base
      .addSelect(`(${this.contactCondition(contactScope)})`, 'owner_contact_visible')
      .orderBy('p.createdAt', 'DESC')
      .addOrderBy('p.id', 'DESC')
      .offset(query.offset)
      .limit(query.pageSize)
      .getRawAndEntities<{ p_id: string; owner_contact_visible: boolean }>();

    const visibleIds = new Set(
      raw.filter((row) => row.owner_contact_visible === true).map((row) => row.p_id),
    );
    const items = entities.map((property) =>
      toPropertyListItem(property, visibleIds.has(property.id)),
    );
    return new Paginated(items, query.page, query.pageSize, total);
  }

  /**
   * Sửa BĐS (TASK-052): chỉ đổi các trường được gửi, trong transaction có khoá dòng.
   * - Ngoài phạm vi `property.view`, đã xoá hoặc công ty khác → 404; xem được nhưng ngoài phạm vi
   *   `property.edit` → 403.
   * - `expectedUpdatedAt` khác `updatedAt` hiện tại → 409 (phase0/05-API-CONVENTIONS.md mục 8).
   * - Toạ độ, hoa hồng (theo cặp, % ≤ 100) và địa giới kiểm trên giá trị sau khi gộp.
   * Trả về chi tiết BĐS như `GET /properties/:id`.
   */
  async update(
    actor: Actor,
    id: string,
    dto: UpdatePropertyDto,
    scopes: PropertyScopes,
  ): Promise<PropertyDetailResponse> {
    const patch: Record<string, unknown> = {};
    for (const field of EDITABLE_PROPERTY_FIELDS) {
      if (dto[field] !== undefined) {
        patch[field] = dto[field];
      }
    }
    if (Object.keys(patch).length === 0) {
      throw invalid([{ message: 'Cần gửi ít nhất một trường để cập nhật' }]);
    }

    await this.dataSource.transaction(async (manager) => {
      const properties = this.properties.withManager(manager);
      const current = await this.lockForAction(
        properties,
        actor,
        id,
        scopes.view,
        scopes.edit,
        'Không có quyền sửa BĐS này',
      );
      if (
        dto.expectedUpdatedAt &&
        dto.expectedUpdatedAt.getTime() !== current.updatedAt.getTime()
      ) {
        throw new AppException(
          ErrorCode.CONFLICT,
          'BĐS đã được người khác cập nhật, vui lòng tải lại rồi sửa tiếp',
        );
      }

      const merged = { ...current, ...patch } as Property;
      assertPairs(merged);
      if ('provinceId' in patch || 'wardId' in patch || 'districtId' in patch) {
        await this.assertLocation(merged);
      }
      await properties.update(actor.tenantId, id, {
        ...patch,
        updatedBy: actor.userId,
      } as TenantWritable<Property>);
    });

    return this.findOne(actor, id, scopes.view ?? 'OWN', scopes.contact);
  }

  /**
   * Xoá mềm BĐS (TASK-053) → 204. Ngoài phạm vi `property.view`, đã xoá hoặc công ty khác → 404;
   * xem được nhưng ngoài phạm vi `property.delete` → 403. Ghi người xoá vào `updated_by`.
   * Ảnh, giấy tờ, lịch hẹn, giao dịch… của BĐS giữ nguyên trong database.
   */
  async remove(
    actor: Actor,
    id: string,
    scopes: { view: PermissionScope | undefined; delete: PermissionScope },
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const properties = this.properties.withManager(manager);
      await this.lockForAction(
        properties,
        actor,
        id,
        scopes.view,
        scopes.delete,
        'Không có quyền xoá BĐS này',
      );
      await properties.update(actor.tenantId, id, { updatedBy: actor.userId });
      await properties.softDelete(actor.tenantId, id);
    });
  }

  /**
   * Khoá dòng BĐS (FOR UPDATE) trước khi sửa/xoá và kiểm quyền theo bản ghi:
   * không có, ngoài phạm vi xem → 404; xem được nhưng ngoài phạm vi thao tác → 403.
   */
  private async lockForAction(
    properties: TenantRepository<Property>,
    actor: Actor,
    id: string,
    viewScope: PermissionScope | undefined,
    actionScope: PermissionScope | undefined,
    forbiddenMessage: string,
  ): Promise<Property> {
    const { entities, raw } = await properties
      .createQueryBuilder(actor.tenantId, 'p', (query) => query.where('p.id = :id', { id }))
      .addSelect(`(${this.scopeOrFalse(viewScope)})`, 'in_view')
      .addSelect(`(${this.scopeOrFalse(actionScope)})`, 'in_action')
      .setParameter('scopeUserId', actor.userId)
      .setLock('pessimistic_write')
      .getRawAndEntities<{ in_view: boolean; in_action: boolean }>();
    const current = entities[0];
    if (!current || raw[0]?.in_view !== true) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Không tìm thấy BĐS');
    }
    if (raw[0].in_action !== true) {
      throw new AppException(ErrorCode.FORBIDDEN, forbiddenMessage);
    }
    return current;
  }

  /** Điều kiện phạm vi, hoặc FALSE khi user không có quyền đó. */
  private scopeOrFalse(scope: PermissionScope | undefined): string {
    return scope ? scopeCondition(scope, PROPERTY_SCOPE_COLUMNS) : 'FALSE';
  }

  /** Điều kiện SQL "user được xem liên hệ chủ nhà của BĐS `p`". */
  private contactCondition(contactScope: PermissionScope | undefined): string {
    return this.scopeOrFalse(contactScope);
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
  private async assertLocation(dto: LocationInput): Promise<void> {
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

/** Toạ độ và hoa hồng đi theo cặp; hoa hồng theo % không quá 100. */
function assertPairs(property: Property): void {
  const details: ErrorDetail[] = [];
  if ((property.latitude === null) !== (property.longitude === null)) {
    details.push({ field: 'latitude', message: 'latitude và longitude phải có cùng nhau' });
  }
  if ((property.commissionType === null) !== (property.commissionValue === null)) {
    details.push({
      field: 'commissionValue',
      message: 'commissionType và commissionValue phải có cùng nhau',
    });
  } else if (property.commissionType === 'PERCENT' && (property.commissionValue ?? 0) > 100) {
    details.push({ field: 'commissionValue', message: 'Hoa hồng theo % phải từ 0 đến 100' });
  }
  if (details.length > 0) {
    throw invalid(details);
  }
}

function invalid(details: ErrorDetail[]): AppException {
  return new AppException(ErrorCode.VALIDATION_ERROR, undefined, details);
}
