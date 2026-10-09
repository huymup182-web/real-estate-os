import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  type EntityManager,
  type ObjectLiteral,
  Repository,
  type SelectQueryBuilder,
} from 'typeorm';

import { AppException, type ErrorDetail } from '../common/errors/app.exception.js';
import { type AuditChanges, AuditService } from '../audit/audit.service.js';
import { scopeCondition } from '../auth/record-scope.js';
import type { PermissionScope } from '../auth/permission.service.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { Paginated } from '../common/response/paginated.js';
import type { PaginationQueryDto } from '../common/response/pagination-query.dto.js';
import { keywordTsQuery } from '../search/keyword.js';
import { searchRangeErrors } from '../search/search-filters.js';
import type { PropertySearchQueryDto, PropertySort } from '../search/property-search-query.dto.js';
import { TenantRepository, type TenantWritable } from '../database/tenant.repository.js';
import type { AssignPropertyDto } from './dto/assign-property.dto.js';
import type { ChangePropertyStatusDto } from './dto/change-property-status.dto.js';
import type { CreatePropertyDto } from './dto/create-property.dto.js';
import type { SetPropertyOwnerDto } from './dto/set-property-owner.dto.js';
import type { VerifyPropertyDto } from './dto/verify-property.dto.js';
import { EDITABLE_PROPERTY_FIELDS, type UpdatePropertyDto } from './dto/update-property.dto.js';
import { Property } from './property.entity.js';
import {
  type PropertyDetailResponse,
  type PropertyListItem,
  type PropertyOwnerContact,
  type PropertyResponse,
  type PropertyViewerFlags,
  toPropertyDetailResponse,
  toPropertyListItem,
  toPropertyResponse,
} from './property.response.js';
import {
  canUserChangeStatus,
  DEFAULT_VERIFY_INTERVAL_DAYS,
  formatPropertyCode,
  MAX_VERIFY_INTERVAL_DAYS,
  NEEDS_VERIFICATION,
} from './property-values.js';

/** Người thực hiện thao tác, lấy từ access token (không bao giờ từ body). */
export interface Actor {
  userId: string;
  tenantId: string;
}

/** Phạm vi quyền của user với BĐS, lấy từ `req.user.permissions`. Không có key = không có quyền. */
export interface PropertyScopes {
  view: PermissionScope | undefined;
  edit: PermissionScope | undefined;
  delete: PermissionScope | undefined;
  contact: PermissionScope | undefined;
  assign: PermissionScope | undefined;
  documents: PermissionScope | undefined;
  verify: PermissionScope | undefined;
}

/** Địa giới của BĐS cần kiểm. */
interface LocationInput {
  provinceId: string;
  wardId: string;
  districtId?: string | null;
}

/** Cùng một người xem lại BĐS trong khoảng này (phút) chỉ tính một lượt (TASK-060). */
export const VIEW_DEDUP_MINUTES = 30;

/** Thống kê lượt xem BĐS (TASK-060). */
export interface PropertyViewStats {
  totalViews: number;
  uniqueViewers: number;
  last7DaysViews: number;
  lastViewedAt: Date | null;
}

/** Một dòng nhật ký hoạt động BĐS (TASK-063). `user` null khi hệ thống tự làm. */
export interface PropertyActivity {
  id: string;
  action: string;
  changes: AuditChanges | null;
  user: { id: string; fullName: string } | null;
  createdAt: Date;
}

interface ActivityRow {
  id: string;
  action: string;
  changes: AuditChanges | null;
  created_at: Date;
  user_id: string | null;
  full_name: string | null;
}

/** Trường chỉ người xem được liên hệ chủ nhà mới thấy (phase0/04-RBAC.md, Q5). */
const CONTACT_FIELDS = ['streetAddress', 'latitude', 'longitude'];

function withoutContactFields(changes: AuditChanges): AuditChanges | null {
  const visible = Object.fromEntries(
    Object.entries(changes).filter(([field]) => !CONTACT_FIELDS.includes(field)),
  );
  return Object.keys(visible).length > 0 ? visible : null;
}

/** `{ field: [cũ, mới] }` cho các trường thật sự đổi giá trị; không đổi gì → null. */
function diff(current: Property, patch: Record<string, unknown>): AuditChanges | null {
  const changes: AuditChanges = {};
  for (const [field, next] of Object.entries(patch)) {
    const previous = (current as unknown as Record<string, unknown>)[field] ?? null;
    if (JSON.stringify(previous) !== JSON.stringify(next ?? null)) {
      changes[field] = [previous, next ?? null];
    }
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

/** Cờ "user đã lưu BĐS `p` vào yêu thích". */
const IS_FAVORITE = `EXISTS (SELECT 1 FROM property_favorites fav
  WHERE fav.property_id = p.id AND fav.tenant_id = p.tenant_id AND fav.user_id = :scopeUserId)`;

interface ViewerFlagsRow {
  owner_contact_visible: boolean;
  is_favorite: boolean;
}

function viewerFlags(row: ViewerFlagsRow): PropertyViewerFlags {
  return {
    ownerContactVisible: row.owner_contact_visible === true,
    isFavorite: row.is_favorite === true,
  };
}

/** Cột xét phạm vi của BĐS: môi giới phụ trách và người tạo. */
const PROPERTY_SCOPE_COLUMNS = { agent: 'p.agent_id', creator: 'p.created_by' };

/** Xét người nhận BĐS `u` như người phụ trách của bản ghi (OWN = chính mình). */
const AGENT_SCOPE_COLUMNS = { agent: 'u.id', creator: 'u.id' };

@Injectable()
export class PropertiesService {
  private readonly properties: TenantRepository<Property>;

  constructor(
    @InjectRepository(Property) repository: Repository<Property>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
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
      const created = await this.properties.withManager(manager).create(actor.tenantId, {
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
      await this.recordActivity(manager, actor, created.id, 'property.create');
      return created;
    });
    return toPropertyResponse(property);
  }

  /**
   * Chi tiết BĐS (TASK-050). Ngoài phạm vi `property.view` của user, đã xoá hoặc thuộc công ty khác → 404
   * (không lộ BĐS có tồn tại). Địa chỉ chi tiết và chủ nhà chỉ trả khi BĐS nằm trong phạm vi
   * `property.view_owner_contact` của user (phase0/04-RBAC.md, Q5).
   */
  async findOne(actor: Actor, id: string, scopes: PropertyScopes): Promise<PropertyDetailResponse> {
    const { entities, raw } = await this.properties
      .createQueryBuilder(actor.tenantId, 'p', (query) =>
        query.where('p.id = :id', { id }).andWhere(this.visibleCondition(scopes)),
      )
      .addSelect(`(${this.scopeOrFalse(scopes.contact)})`, 'owner_contact_visible')
      .addSelect(IS_FAVORITE, 'is_favorite')
      .setParameter('scopeUserId', actor.userId)
      .getRawAndEntities<ViewerFlagsRow>();

    const property = entities[0];
    const row = raw[0];
    if (!property || !row) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Không tìm thấy BĐS');
    }
    const flags = viewerFlags(row);
    const owner =
      flags.ownerContactVisible && property.ownerId
        ? await this.findOwner(actor.tenantId, property.ownerId)
        : null;
    return toPropertyDetailResponse(property, owner, flags);
  }

  /**
   * Danh sách BĐS trong phạm vi `property.view` của user (TASK-051), mới tạo trước, phân trang offset.
   * Không gồm BĐS đã xoá mềm. Lọc, tìm kiếm và các kiểu sắp xếp khác làm ở Phase 5 (TASK-064..074).
   */
  async findAll(
    actor: Actor,
    query: PropertySearchQueryDto,
    scopes: PropertyScopes,
  ): Promise<Paginated<PropertyListItem>> {
    const rangeErrors = searchRangeErrors(query);
    if (rangeErrors.length > 0) {
      throw invalid(rangeErrors);
    }
    return this.list(actor, query, scopes, false, query);
  }

  /**
   * BĐS yêu thích của user (TASK-059), mới lưu trước. Chỉ gồm BĐS user vẫn xem được (BĐS đã xoá, bị ẩn
   * hoặc ra khỏi phạm vi xem thì không hiện, lưu lại khi xem được lại).
   */
  async findFavorites(
    actor: Actor,
    query: PaginationQueryDto,
    scopes: PropertyScopes,
  ): Promise<Paginated<PropertyListItem>> {
    return this.list(actor, query, scopes, true);
  }

  /** Lưu BĐS vào yêu thích (TASK-059). Cần xem được BĐS (không thì 404); lưu lại lần nữa không đổi gì. */
  async addFavorite(actor: Actor, id: string, scopes: PropertyScopes): Promise<void> {
    await this.scopeFlags(actor, id, scopes, {});
    await this.dataSource.query(
      `INSERT INTO property_favorites (tenant_id, user_id, property_id) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, property_id) DO NOTHING`,
      [actor.tenantId, actor.userId, id],
    );
  }

  /**
   * Bỏ BĐS khỏi yêu thích của chính user (TASK-059). Không cần xem được BĐS (để bỏ được cả BĐS đã ẩn);
   * chưa lưu thì không đổi gì.
   */
  async removeFavorite(actor: Actor, id: string): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM property_favorites WHERE tenant_id = $1 AND user_id = $2 AND property_id = $3`,
      [actor.tenantId, actor.userId, id],
    );
  }

  /**
   * Ghi lượt xem chi tiết BĐS (TASK-060). Cùng một người mở lại trong 30 phút chỉ tính một lần, để tải
   * lại trang không làm tăng số liệu. Gọi sau khi đã đọc được chi tiết (BĐS xem được).
   */
  async recordView(actor: Actor, id: string): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO property_views (tenant_id, property_id, user_id)
       SELECT $1, $2, $3
        WHERE NOT EXISTS (
          SELECT 1 FROM property_views
           WHERE tenant_id = $1 AND property_id = $2 AND user_id = $3
             AND viewed_at > now() - make_interval(mins => $4))`,
      [actor.tenantId, id, actor.userId, VIEW_DEDUP_MINUTES],
    );
  }

  /**
   * Thống kê lượt xem BĐS (TASK-060): tổng, số người xem khác nhau, 7 ngày gần nhất, lần xem gần nhất.
   * Chỉ người sửa được BĐS (phụ trách và cấp quản lý trong phạm vi) xem được: không xem được BĐS → 404,
   * ngoài phạm vi `property.edit` → 403.
   */
  async viewStats(actor: Actor, id: string, scopes: PropertyScopes): Promise<PropertyViewStats> {
    const { edit } = await this.scopeFlags(actor, id, scopes, { edit: scopes.edit });
    if (!edit) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Không có quyền xem thống kê lượt xem BĐS này');
    }
    const [row] = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS "totalViews",
              COUNT(DISTINCT user_id)::int AS "uniqueViewers",
              (COUNT(*) FILTER (WHERE viewed_at > now() - interval '7 days'))::int AS "last7DaysViews",
              MAX(viewed_at) AS "lastViewedAt"
         FROM property_views
        WHERE tenant_id = $1 AND property_id = $2`,
      [actor.tenantId, id],
    )) as PropertyViewStats[];
    return row ?? { totalViews: 0, uniqueViewers: 0, last7DaysViews: 0, lastViewedAt: null };
  }

  private async list(
    actor: Actor,
    query: PaginationQueryDto,
    scopes: PropertyScopes,
    favoritesOnly: boolean,
    search?: PropertySearchQueryDto,
  ): Promise<Paginated<PropertyListItem>> {
    const keyword = search?.q;
    let base = this.properties
      .createQueryBuilder(actor.tenantId, 'p', (builder) =>
        builder.where(this.visibleCondition(scopes)),
      )
      .setParameter('scopeUserId', actor.userId);
    if (keyword) {
      base = base.andWhere(this.keywordCondition(keyword, scopes), {
        keywordCode: keyword.toUpperCase(),
        keywordQuery: keywordTsQuery(keyword),
      });
    }
    // Lọc giá (TASK-065), gồm cả hai đầu.
    if (search?.priceMin !== undefined) {
      base = base.andWhere('p.price >= :priceMin', { priceMin: search.priceMin });
    }
    if (search?.priceMax !== undefined) {
      base = base.andWhere('p.price <= :priceMax', { priceMax: search.priceMax });
    }
    // Lọc diện tích (TASK-066), m², gồm cả hai đầu.
    if (search?.areaMin !== undefined) {
      base = base.andWhere('p.area >= :areaMin', { areaMin: search.areaMin });
    }
    if (search?.areaMax !== undefined) {
      base = base.andWhere('p.area <= :areaMax', { areaMax: search.areaMax });
    }
    // Lọc khu vực (TASK-067): tỉnh, quận/huyện cũ, phường/xã của BĐS; nhiều điều kiện thì phải khớp hết.
    if (search?.provinceId) {
      base = base.andWhere('p.provinceId = :provinceId', { provinceId: search.provinceId });
    }
    if (search?.districtId) {
      base = base.andWhere('p.districtId = :districtId', { districtId: search.districtId });
    }
    if (search?.wardId) {
      base = base.andWhere('p.wardId = :wardId', { wardId: search.wardId });
    }
    // Lọc loại BĐS (TASK-068): khớp một trong các loại đã chọn.
    if (search?.propertyType) {
      base = base.andWhere('p.propertyType IN (:...propertyTypes)', {
        propertyTypes: search.propertyType,
      });
    }
    // Lọc số phòng ngủ/phòng tắm (TASK-069): BĐS chưa ghi số phòng (NULL) không khớp.
    if (search?.bedroomsMin !== undefined) {
      base = base.andWhere('p.bedrooms >= :bedroomsMin', { bedroomsMin: search.bedroomsMin });
    }
    if (search?.bedroomsMax !== undefined) {
      base = base.andWhere('p.bedrooms <= :bedroomsMax', { bedroomsMax: search.bedroomsMax });
    }
    if (search?.bathroomsMin !== undefined) {
      base = base.andWhere('p.bathrooms >= :bathroomsMin', { bathroomsMin: search.bathroomsMin });
    }
    if (search?.bathroomsMax !== undefined) {
      base = base.andWhere('p.bathrooms <= :bathroomsMax', { bathroomsMax: search.bathroomsMax });
    }
    // Lọc pháp lý (TASK-070): khớp một trong các tình trạng đã chọn; BĐS chưa ghi pháp lý không khớp.
    if (search?.legalStatus) {
      base = base.andWhere('p.legalStatus IN (:...legalStatuses)', {
        legalStatuses: search.legalStatus,
      });
    }
    // Lọc hướng nhà (TASK-071): khớp một trong các hướng đã chọn; BĐS chưa ghi hướng không khớp.
    if (search?.direction) {
      base = base.andWhere('p.direction IN (:...directions)', { directions: search.direction });
    }
    // Lọc độ rộng đường (TASK-072): BĐS chưa ghi độ rộng (NULL) không khớp.
    if (search?.roadWidthMin !== undefined) {
      base = base.andWhere('p.roadWidth >= :roadWidthMin', { roadWidthMin: search.roadWidthMin });
    }
    if (search?.roadWidthMax !== undefined) {
      base = base.andWhere('p.roadWidth <= :roadWidthMax', { roadWidthMax: search.roadWidthMax });
    }
    if (favoritesOnly) {
      base = base.innerJoin(
        'property_favorites',
        'f',
        'f.property_id = p.id AND f.tenant_id = p.tenant_id AND f.user_id = :scopeUserId',
      );
    }

    const total = await base.clone().getCount();
    let page = base
      .addSelect(`(${this.scopeOrFalse(scopes.contact)})`, 'owner_contact_visible')
      .addSelect(IS_FAVORITE, 'is_favorite');
    if (favoritesOnly) {
      page = page.orderBy('f.created_at', 'DESC');
    } else {
      page = this.applySort(page, search?.sort ?? (keyword ? 'relevance' : 'newest'), keyword);
    }
    page = page.addOrderBy('p.createdAt', 'DESC').addOrderBy('p.id', 'DESC');
    const { entities, raw } = await page
      .offset(query.offset)
      .limit(query.pageSize)
      .getRawAndEntities<ViewerFlagsRow & { p_id: string }>();

    const flagsById = new Map(raw.map((row) => [row.p_id, viewerFlags(row)]));
    const items = entities.map((property) =>
      toPropertyListItem(
        property,
        flagsById.get(property.id) ?? { ownerContactVisible: false, isFavorite: false },
      ),
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
        scopes,
        [scopes.edit],
        'Không có quyền sửa BĐS này',
      );
      assertNotModified(current, dto.expectedUpdatedAt);

      const merged = { ...current, ...patch } as Property;
      assertPairs(merged);
      if ('provinceId' in patch || 'wardId' in patch || 'districtId' in patch) {
        await this.assertLocation(merged);
      }
      await properties.update(actor.tenantId, id, {
        ...patch,
        updatedBy: actor.userId,
      } as TenantWritable<Property>);
      const changes = diff(current, patch);
      if (changes) {
        await this.recordActivity(manager, actor, id, 'property.update', changes);
      }
    });

    return this.findOne(actor, id, scopes);
  }

  /**
   * Đổi trạng thái BĐS (TASK-054). Cần `property.edit` với BĐS đó (404/403 như khi sửa).
   * Chỉ đặt được AVAILABLE, PENDING, SOLD, HIDDEN; BĐS đang EXPIRED/VERIFY_REQUIRED không mở bán lại
   * (AVAILABLE, PENDING) được mà phải xác minh → 422. Đặt lại đúng trạng thái đang có thì không đổi gì.
   */
  async changeStatus(
    actor: Actor,
    id: string,
    dto: ChangePropertyStatusDto,
    scopes: PropertyScopes,
  ): Promise<PropertyDetailResponse> {
    await this.dataSource.transaction(async (manager) => {
      const properties = this.properties.withManager(manager);
      const current = await this.lockForAction(
        properties,
        actor,
        id,
        scopes,
        [scopes.edit],
        'Không có quyền đổi trạng thái BĐS này',
      );
      assertNotModified(current, dto.expectedUpdatedAt);
      if (current.status === dto.status) {
        return;
      }
      if (!canUserChangeStatus(current.status, dto.status)) {
        throw new AppException(
          ErrorCode.BUSINESS_RULE_VIOLATION,
          `BĐS đang ${current.status} cần được xác minh lại trước khi mở bán`,
        );
      }
      await properties.update(actor.tenantId, id, {
        status: dto.status,
        updatedBy: actor.userId,
      });
      await this.recordActivity(manager, actor, id, 'property.change_status', {
        status: [current.status, dto.status],
      });
    });
    return this.findOne(actor, id, scopes);
  }

  /**
   * Xác minh lại BĐS (TASK-062): ghi người và thời điểm xác minh, `verificationStatus` = VERIFIED.
   * BĐS đang VERIFY_REQUIRED hoặc EXPIRED được mở bán lại (AVAILABLE); trạng thái khác giữ nguyên.
   * Ngoài phạm vi xem → 404; xem được nhưng ngoài phạm vi `property.verify` → 403.
   */
  async verify(
    actor: Actor,
    id: string,
    dto: VerifyPropertyDto,
    scopes: PropertyScopes,
  ): Promise<PropertyDetailResponse> {
    await this.dataSource.transaction(async (manager) => {
      const properties = this.properties.withManager(manager);
      const current = await this.lockForAction(
        properties,
        actor,
        id,
        scopes,
        [scopes.verify],
        'Không có quyền xác minh BĐS này',
      );
      assertNotModified(current, dto.expectedUpdatedAt);
      await properties.update(actor.tenantId, id, {
        verificationStatus: 'VERIFIED',
        lastVerifiedAt: new Date(),
        verifiedBy: actor.userId,
        ...(NEEDS_VERIFICATION.includes(current.status) ? { status: 'AVAILABLE' } : {}),
        updatedBy: actor.userId,
      });
      const changes: AuditChanges = {
        verificationStatus: [current.verificationStatus, 'VERIFIED'],
      };
      if (NEEDS_VERIFICATION.includes(current.status)) {
        changes['status'] = [current.status, 'AVAILABLE'];
      }
      await this.recordActivity(manager, actor, id, 'property.verify', changes);
    });
    return this.findOne(actor, id, scopes);
  }

  /**
   * Job hệ thống (TASK-062), chạy cho mọi công ty đang hoạt động: BĐS đang AVAILABLE/PENDING quá hạn xác
   * minh (tính từ lần xác minh gần nhất, chưa xác minh thì từ ngày tạo) chuyển sang VERIFY_REQUIRED,
   * `verificationStatus` = EXPIRED. Không đổi `updated_by` (không phải người dùng sửa). Chạy lại không
   * đổi gì thêm. Mỗi BĐS bị chuyển ghi nhật ký `property.verification_expired` không có người làm
   * (TASK-063). Trả về số BĐS vừa chuyển.
   */
  async markOverdueForVerification(): Promise<number> {
    const [row] = (await this.dataSource.query(
      `WITH marked AS (
       UPDATE properties p
          SET status = 'VERIFY_REQUIRED', verification_status = 'EXPIRED'
         FROM companies c, properties old
        WHERE old.id = p.id AND c.id = p.tenant_id AND c.deleted_at IS NULL AND c.status = 'ACTIVE'
          AND p.deleted_at IS NULL AND p.status IN ('AVAILABLE', 'PENDING')
          AND COALESCE(p.last_verified_at, p.created_at) <= now() - make_interval(days =>
                CASE WHEN jsonb_typeof(c.settings -> 'verify_interval_days') = 'number'
                       AND (c.settings ->> 'verify_interval_days') ~ '^[0-9]+$'
                       AND (c.settings ->> 'verify_interval_days')::int BETWEEN 1 AND $2
                     THEN (c.settings ->> 'verify_interval_days')::int
                     ELSE $1 END)
       RETURNING p.tenant_id, p.id, old.status AS old_status,
                 old.verification_status AS old_verification_status
       ), logged AS (
         INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, changes)
         SELECT tenant_id, NULL, 'property.verification_expired', 'property', id,
                jsonb_build_object(
                  'status', jsonb_build_array(old_status, 'VERIFY_REQUIRED'),
                  'verificationStatus', jsonb_build_array(old_verification_status, 'EXPIRED'))
           FROM marked
       )
       SELECT COUNT(*)::int AS count FROM marked`,
      [DEFAULT_VERIFY_INTERVAL_DAYS, MAX_VERIFY_INTERVAL_DAYS],
    )) as { count: number }[];
    return row?.count ?? 0;
  }

  /**
   * Xoá mềm BĐS (TASK-053) → 204. Ngoài phạm vi `property.view`, đã xoá hoặc công ty khác → 404;
   * xem được nhưng ngoài phạm vi `property.delete` → 403. Ghi người xoá vào `updated_by`.
   * Ảnh, giấy tờ, lịch hẹn, giao dịch… của BĐS giữ nguyên trong database.
   */
  async remove(actor: Actor, id: string, scopes: PropertyScopes): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const properties = this.properties.withManager(manager);
      await this.lockForAction(
        properties,
        actor,
        id,
        scopes,
        [scopes.delete],
        'Không có quyền xoá BĐS này',
      );
      await properties.update(actor.tenantId, id, { updatedBy: actor.userId });
      await properties.softDelete(actor.tenantId, id);
      await this.recordActivity(manager, actor, id, 'property.delete');
    });
  }

  /**
   * Đổi môi giới phụ trách BĐS (TASK-056), cần quyền riêng `property.assign` (Huy Lê chọn ngày
   * 2026-10-04, ma trận như `customer.assign`).
   * - BĐS ngoài phạm vi xem → 404; xem được nhưng ngoài phạm vi `property.assign` → 403.
   * - Người nhận phải là user đang hoạt động của cùng công ty (không có → 400 `agentId`) và nằm trong
   *   cùng phạm vi đó (TEAM: cùng nhóm, DEPARTMENT: cùng phòng, COMPANY: cả công ty), ngoài phạm vi → 403.
   * - Giao lại đúng người đang phụ trách thì không đổi gì. Trả về chi tiết BĐS.
   */
  async assign(
    actor: Actor,
    id: string,
    dto: AssignPropertyDto,
    scopes: PropertyScopes,
  ): Promise<PropertyDetailResponse> {
    await this.dataSource.transaction(async (manager) => {
      const properties = this.properties.withManager(manager);
      const current = await this.lockForAction(
        properties,
        actor,
        id,
        scopes,
        [scopes.assign],
        'Không có quyền phân BĐS này',
      );
      assertNotModified(current, dto.expectedUpdatedAt);
      if (current.agentId === dto.agentId) {
        return;
      }
      await this.assertAssignableAgent(manager, actor, dto.agentId, scopes.assign);
      await properties.update(actor.tenantId, id, {
        agentId: dto.agentId,
        updatedBy: actor.userId,
      });
      await this.recordActivity(manager, actor, id, 'property.assign', {
        agentId: [current.agentId, dto.agentId],
      });
    });
    return this.findOne(actor, id, scopes);
  }

  /**
   * Nhập hoặc thay chủ nhà của BĐS (TASK-055). Cần cả `property.edit` và `property.view_owner_contact`
   * với BĐS đó (không xem được → 404, thiếu một trong hai → 403).
   * Mỗi BĐS có bản ghi chủ nhà riêng (phương án mặc định, chờ Huy Lê xác nhận): đã có thì sửa bản ghi đó, chưa có
   * thì tạo mới và gắn vào BĐS. Ghi người sửa vào BĐS. Trả về chi tiết BĐS như `GET /properties/:id`.
   */
  async setOwner(
    actor: Actor,
    id: string,
    dto: SetPropertyOwnerDto,
    scopes: PropertyScopes,
  ): Promise<PropertyDetailResponse> {
    const values = [dto.fullName, dto.phone, dto.email ?? null, dto.notes ?? null, actor.userId];
    await this.dataSource.transaction(async (manager) => {
      const properties = this.properties.withManager(manager);
      const current = await this.lockForOwnerChange(properties, actor, id, scopes);
      assertNotModified(current, dto.expectedUpdatedAt);

      const updated = current.ownerId
        ? (
            (await manager.query(
              `UPDATE owners
                SET full_name = $3, phone = $4, email = $5, notes = $6, updated_by = $7
              WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
          RETURNING id`,
              [actor.tenantId, current.ownerId, ...values],
            )) as [{ id: string }[], number]
          )[0]
        : [];
      let ownerId = updated[0]?.id;
      if (!ownerId) {
        const [created] = (await manager.query(
          `INSERT INTO owners (tenant_id, full_name, phone, email, notes, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $6)
           RETURNING id`,
          [actor.tenantId, ...values],
        )) as { id: string }[];
        ownerId = created?.id;
      }
      await properties.update(actor.tenantId, id, {
        ownerId: ownerId ?? null,
        updatedBy: actor.userId,
      });
      // Chỉ ghi id chủ nhà: tên, SĐT, email chủ nhà không vào nhật ký.
      await this.recordActivity(manager, actor, id, 'property.set_owner', {
        ownerId: [current.ownerId, ownerId ?? null],
      });
    });
    return this.findOne(actor, id, scopes);
  }

  /**
   * Gỡ chủ nhà khỏi BĐS (TASK-055) → 204. Quyền như khi nhập chủ nhà. BĐS chưa có chủ nhà thì không
   * đổi gì. Bản ghi chủ nhà được xoá mềm khi không còn BĐS nào (chưa xoá) dùng nó.
   */
  async removeOwner(actor: Actor, id: string, scopes: PropertyScopes): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const properties = this.properties.withManager(manager);
      const current = await this.lockForOwnerChange(properties, actor, id, scopes);
      if (!current.ownerId) {
        return;
      }
      await properties.update(actor.tenantId, id, { ownerId: null, updatedBy: actor.userId });
      await this.recordActivity(manager, actor, id, 'property.remove_owner', {
        ownerId: [current.ownerId, null],
      });
      await manager.query(
        `UPDATE owners o
            SET deleted_at = now(), updated_by = $3
          WHERE o.tenant_id = $1 AND o.id = $2 AND o.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM properties p
               WHERE p.tenant_id = o.tenant_id AND p.owner_id = o.id AND p.deleted_at IS NULL)`,
        [actor.tenantId, current.ownerId, actor.userId],
      );
    });
  }

  /**
   * Khoá BĐS trong transaction của module khác (ảnh, giấy tờ BĐS) để thay đổi dữ liệu con của BĐS:
   * không xem được → 404; xem được nhưng ngoài phạm vi `property.edit` (hoặc một phạm vi thêm) → 403.
   */
  lockEditable(
    manager: EntityManager,
    actor: Actor,
    id: string,
    scopes: PropertyScopes,
    forbiddenMessage: string,
    extraScopes: (PermissionScope | undefined)[] = [],
  ): Promise<Property> {
    return this.lockForAction(
      this.properties.withManager(manager),
      actor,
      id,
      scopes,
      [scopes.edit, ...extraScopes],
      forbiddenMessage,
    );
  }

  /**
   * BĐS có nằm trong từng phạm vi `checks` không (vd quyền xem giấy tờ). Không xem được BĐS → 404.
   */
  async scopeFlags<K extends string>(
    actor: Actor,
    id: string,
    scopes: PropertyScopes,
    checks: Record<K, PermissionScope | undefined>,
  ): Promise<Record<K, boolean>> {
    const keys = Object.keys(checks) as K[];
    let query = this.properties
      .createQueryBuilder(actor.tenantId, 'p', (builder) =>
        builder.where('p.id = :id', { id }).andWhere(this.visibleCondition(scopes)),
      )
      .setParameter('scopeUserId', actor.userId);
    keys.forEach((key, index) => {
      query = query.addSelect(`(${this.scopeOrFalse(checks[key])})`, `flag_${index}`);
    });
    const row = await query.getRawOne<Record<string, boolean>>();
    if (!row) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Không tìm thấy BĐS');
    }
    return Object.fromEntries(
      keys.map((key, index) => [key, row[`flag_${index}`] === true]),
    ) as Record<K, boolean>;
  }

  /**
   * Ghi một hoạt động của BĐS vào nhật ký (TASK-063), trong transaction của thao tác. Module ảnh, giấy
   * tờ, link chia sẻ dùng chung để mọi hoạt động của BĐS nằm một chỗ.
   */
  recordActivity(
    manager: EntityManager,
    actor: Actor,
    propertyId: string,
    action: `property.${string}`,
    changes: AuditChanges | null = null,
  ): Promise<void> {
    return this.audit.record(manager, {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action,
      entityType: 'property',
      entityId: propertyId,
      changes,
    });
  }

  /**
   * Nhật ký hoạt động của BĐS (TASK-063), mới trước, phân trang. Chỉ người sửa được BĐS xem được (như
   * thống kê lượt xem): không xem được BĐS → 404, ngoài phạm vi `property.edit` → 403. Địa chỉ chi tiết
   * và toạ độ trong nhật ký chỉ hiện khi BĐS nằm trong phạm vi `property.view_owner_contact`.
   */
  async activities(
    actor: Actor,
    id: string,
    query: PaginationQueryDto,
    scopes: PropertyScopes,
  ): Promise<Paginated<PropertyActivity>> {
    const { edit, contact } = await this.scopeFlags(actor, id, scopes, {
      edit: scopes.edit,
      contact: scopes.contact,
    });
    if (!edit) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Không có quyền xem nhật ký hoạt động BĐS này');
    }
    const [count] = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM audit_logs
        WHERE tenant_id = $1 AND entity_type = 'property' AND entity_id = $2`,
      [actor.tenantId, id],
    )) as { total: number }[];
    const rows = (await this.dataSource.query(
      `SELECT a.id, a.action, a.changes, a.created_at, a.user_id, u.full_name
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
        WHERE a.tenant_id = $1 AND a.entity_type = 'property' AND a.entity_id = $2
        ORDER BY a.created_at DESC, a.id DESC
        OFFSET $3 LIMIT $4`,
      [actor.tenantId, id, query.offset, query.pageSize],
    )) as ActivityRow[];
    const items = rows.map((row) => ({
      id: row.id,
      action: row.action,
      changes: row.changes && !contact ? withoutContactFields(row.changes) : row.changes,
      user: row.user_id ? { id: row.user_id, fullName: row.full_name ?? '' } : null,
      createdAt: row.created_at,
    }));
    return new Paginated(items, query.page, query.pageSize, count?.total ?? 0);
  }

  /**
   * Thứ tự danh sách (TASK-073); sau thứ tự này luôn là mới tạo trước rồi id để phân trang ổn định.
   * `relevance`: đúng mã BĐS lên đầu, rồi theo mức khớp từ khoá với tiêu đề + mô tả (không tính địa chỉ,
   * để thứ tự không lộ địa chỉ của BĐS ngoài phạm vi xem liên hệ). Không có từ khoá → như `newest`.
   */
  private applySort<T extends ObjectLiteral>(
    page: SelectQueryBuilder<T>,
    sort: PropertySort,
    keyword: string | undefined,
  ): SelectQueryBuilder<T> {
    switch (sort) {
      case 'price_asc':
        return page.orderBy('p.price', 'ASC');
      case 'price_desc':
        return page.orderBy('p.price', 'DESC');
      case 'area_asc':
        return page.orderBy('p.area', 'ASC');
      case 'area_desc':
        return page.orderBy('p.area', 'DESC');
      case 'relevance':
        if (!keyword) {
          return page;
        }
        page = page.orderBy('CASE WHEN p.code = :keywordCode THEN 0 ELSE 1 END', 'ASC');
        if (keywordTsQuery(keyword) === null) {
          return page;
        }
        return page.addOrderBy(
          `ts_rank(to_tsvector('simple', immutable_unaccent(
             coalesce(p.title, '') || ' ' || coalesce(p.description, ''))),
           to_tsquery('simple', :keywordQuery))`,
          'DESC',
        );
      case 'newest':
        return page;
    }
  }

  /**
   * Tìm theo từ khoá (TASK-064): đúng mã BĐS, hoặc mọi từ có trong tiêu đề, mô tả, địa chỉ (không phân
   * biệt dấu, từ cuối theo tiền tố) qua `search_vector` có index GIN. Địa chỉ chi tiết là thông tin
   * giới hạn: với BĐS ngoài phạm vi `property.view_owner_contact`, từ khoá phải khớp tiêu đề hoặc mô tả,
   * để không dò được địa chỉ bằng tìm kiếm.
   */
  private keywordCondition(keyword: string, scopes: PropertyScopes): string {
    if (keywordTsQuery(keyword) === null) {
      return 'p.code = :keywordCode';
    }
    return `(p.code = :keywordCode OR (
      p.search_vector @@ to_tsquery('simple', :keywordQuery)
      AND ((${this.scopeOrFalse(scopes.contact)})
        OR to_tsvector('simple', immutable_unaccent(
             coalesce(p.title, '') || ' ' || coalesce(p.description, '')))
           @@ to_tsquery('simple', :keywordQuery))))`;
  }

  /** BĐS không xem được (không có, đã xoá, công ty khác, ngoài phạm vi, HIDDEN với người không sửa được) → 404. */
  async assertVisible(actor: Actor, id: string, scopes: PropertyScopes): Promise<void> {
    const count = await this.properties
      .createQueryBuilder(actor.tenantId, 'p', (query) =>
        query.where('p.id = :id', { id }).andWhere(this.visibleCondition(scopes)),
      )
      .setParameter('scopeUserId', actor.userId)
      .getCount();
    if (count === 0) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Không tìm thấy BĐS');
    }
  }

  /** Khoá BĐS để đổi chủ nhà: cần cả quyền sửa lẫn quyền xem liên hệ chủ nhà với BĐS đó. */
  private lockForOwnerChange(
    properties: TenantRepository<Property>,
    actor: Actor,
    id: string,
    scopes: PropertyScopes,
  ): Promise<Property> {
    return this.lockForAction(
      properties,
      actor,
      id,
      scopes,
      [scopes.edit, scopes.contact],
      'Không có quyền sửa chủ nhà của BĐS này',
    );
  }

  /**
   * Khoá dòng BĐS (FOR UPDATE) trước khi sửa/xoá và kiểm quyền theo bản ghi:
   * không có, ngoài phạm vi xem → 404; xem được nhưng ngoài một trong các phạm vi thao tác
   * → 403.
   */
  private async lockForAction(
    properties: TenantRepository<Property>,
    actor: Actor,
    id: string,
    scopes: PropertyScopes,
    actionScopes: (PermissionScope | undefined)[],
    forbiddenMessage: string,
  ): Promise<Property> {
    const actionCondition = actionScopes
      .map((scope) => `(${this.scopeOrFalse(scope)})`)
      .join(' AND ');
    const { entities, raw } = await properties
      .createQueryBuilder(actor.tenantId, 'p', (query) => query.where('p.id = :id', { id }))
      .addSelect(`(${this.visibleCondition(scopes)})`, 'in_view')
      .addSelect(`(${actionCondition})`, 'in_action')
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

  /** Người nhận BĐS: user đang hoạt động của công ty và trong phạm vi phân BĐS của người giao. */
  private async assertAssignableAgent(
    manager: EntityManager,
    actor: Actor,
    agentId: string,
    scope: PermissionScope | undefined,
  ): Promise<void> {
    const [row] = (await manager
      .createQueryBuilder()
      .select(`(${this.scopeOrFalse(scope, AGENT_SCOPE_COLUMNS)})`, 'in_scope')
      .from('users', 'u')
      .where('u.tenant_id = :tenantId', { tenantId: actor.tenantId })
      .andWhere('u.id = :agentId', { agentId })
      .andWhere(`u.status = 'ACTIVE'`)
      .andWhere('u.deleted_at IS NULL')
      .setParameter('scopeUserId', actor.userId)
      .getRawMany()) as { in_scope: boolean }[];
    if (!row) {
      throw invalid([{ field: 'agentId', message: 'Môi giới không tồn tại hoặc không hoạt động' }]);
    }
    if (row.in_scope !== true) {
      throw new AppException(
        ErrorCode.FORBIDDEN,
        'Không được giao BĐS cho người ngoài phạm vi quản lý của mình',
      );
    }
  }

  /**
   * Điều kiện "user xem được BĐS `p`": trong phạm vi `property.view`; BĐS đang HIDDEN thì phải trong
   * phạm vi `property.edit` (Huy Lê chọn ngày 2026-10-04: chỉ người sửa được mới thấy BĐS ẩn).
   */
  private visibleCondition(scopes: PropertyScopes): string {
    return `((${this.scopeOrFalse(scopes.view)}) AND (p.status <> 'HIDDEN' OR (${this.scopeOrFalse(
      scopes.edit,
    )})))`;
  }

  /** Điều kiện phạm vi, hoặc FALSE khi user không có quyền đó. */
  private scopeOrFalse(
    scope: PermissionScope | undefined,
    columns = PROPERTY_SCOPE_COLUMNS,
  ): string {
    return scope ? scopeCondition(scope, columns) : 'FALSE';
  }

  private async findOwner(tenantId: string, ownerId: string): Promise<PropertyOwnerContact | null> {
    const [owner] = (await this.dataSource.query(
      `SELECT id, full_name AS "fullName", phone, email, notes
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

/** `expectedUpdatedAt` client gửi khác `updatedAt` hiện tại → 409 (phase0/05-API-CONVENTIONS.md mục 8). */
function assertNotModified(current: Property, expectedUpdatedAt: Date | undefined): void {
  if (expectedUpdatedAt && expectedUpdatedAt.getTime() !== current.updatedAt.getTime()) {
    throw new AppException(
      ErrorCode.CONFLICT,
      'BĐS đã được người khác cập nhật, vui lòng tải lại rồi thao tác lại',
    );
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
