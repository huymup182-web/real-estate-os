import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository, type SelectQueryBuilder } from 'typeorm';

import { type AuditChanges, AuditService } from '../audit/audit.service.js';
import type { PermissionScope } from '../auth/permission.service.js';
import { scopeCondition } from '../auth/record-scope.js';
import { AppException, type ErrorDetail } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { Paginated } from '../common/response/paginated.js';
import { CustomersService, type CustomerScopes } from '../customers/customers.service.js';
import { TenantRepository, type TenantWritable } from '../database/tenant.repository.js';
import {
  type Actor,
  PropertiesService,
  type PropertyScopes,
} from '../properties/properties.service.js';
import { CLOSED_DEAL_STAGES, type DealStage, PRICE_REQUIRED_STAGES } from './deal-values.js';
import { Deal } from './deal.entity.js';
import {
  type ChangeDealStageDto,
  type CreateDealDto,
  type DealListQueryDto,
  EDITABLE_DEAL_FIELDS,
  type UpdateDealDto,
} from './dto/deal.dto.js';

/** Phạm vi quyền giao dịch của user. Không có key = không có quyền. */
export interface DealScopes {
  view: PermissionScope | undefined;
  manage: PermissionScope | undefined;
}

/** Quyền của user với khách và BĐS, để kiểm khách/BĐS của giao dịch. */
export interface RelatedScopes {
  customers: CustomerScopes;
  properties: PropertyScopes;
}

/** Giao dịch trả cho client, kèm tên khách và mã, tiêu đề BĐS. */
export interface DealResponse {
  id: string;
  customer: { id: string; fullName: string };
  property: { id: string; code: string; title: string };
  agentId: string;
  stage: string;
  dealPrice: number | null;
  depositAmount: number | null;
  depositAt: Date | null;
  closedAt: Date | null;
  notes: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface NamesRow {
  d_id: string;
  customer_name: string;
  property_code: string;
  property_title: string;
}

/** Cột xét phạm vi của giao dịch: môi giới của giao dịch và người tạo. */
const DEAL_SCOPE_COLUMNS = { agent: 'd.agent_id', creator: 'd.created_by' };

/**
 * Giao dịch (TASK-110). Quyền `deal.view` / `deal.manage` (phase0/04-RBAC.md), phạm vi xét theo môi giới
 * của giao dịch hoặc người tạo. Hoa hồng (`commissions`) chưa làm ở task này.
 */
@Injectable()
export class DealsService {
  private readonly deals: TenantRepository<Deal>;

  constructor(
    @InjectRepository(Deal) repository: Repository<Deal>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
    private readonly properties: PropertiesService,
  ) {
    this.deals = new TenantRepository(repository);
  }

  /**
   * Tạo giao dịch → 201: môi giới là người tạo, bước NEGOTIATING. Khách và BĐS phải là khách/BĐS người tạo
   * xem được (không thì 400 `customerId`/`propertyId`).
   */
  async create(
    actor: Actor,
    dto: CreateDealDto,
    related: RelatedScopes,
    scopes: DealScopes,
  ): Promise<DealResponse> {
    await this.assertCustomer(actor, dto.customerId, related.customers);
    await this.assertProperty(actor, dto.propertyId, related.properties);

    const deal = await this.dataSource.transaction(async (manager) => {
      const created = await this.deals.withManager(manager).create(actor.tenantId, {
        customerId: dto.customerId,
        propertyId: dto.propertyId,
        agentId: actor.userId,
        dealPrice: dto.dealPrice ?? null,
        depositAmount: dto.depositAmount ?? null,
        depositAt: dto.depositAt ?? null,
        notes: dto.notes ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
      await this.record(manager, actor, created.id, 'deal.create');
      return created;
    });
    return this.findOne(actor, deal.id, scopes);
  }

  /** Chi tiết giao dịch. Ngoài phạm vi `deal.view`, đã xoá, công ty khác → 404. */
  async findOne(actor: Actor, id: string, scopes: DealScopes): Promise<DealResponse> {
    const [item] = await this.withNames(
      this.visible(actor, scopes, (query) => query.andWhere('d.id = :id', { id })),
    );
    if (!item) {
      throw notFound();
    }
    return item;
  }

  /** Giao dịch trong phạm vi `deal.view`, mới tạo trước, phân trang; lọc `stage`, `customerId`, `propertyId`. */
  async findAll(
    actor: Actor,
    query: DealListQueryDto,
    scopes: DealScopes,
  ): Promise<Paginated<DealResponse>> {
    const base = this.visible(actor, scopes, (builder) => {
      let filtered = builder;
      if (query.stage) {
        filtered = filtered.andWhere('d.stage IN (:...stages)', { stages: query.stage });
      }
      if (query.customerId) {
        filtered = filtered.andWhere('d.customerId = :customerId', {
          customerId: query.customerId,
        });
      }
      if (query.propertyId) {
        filtered = filtered.andWhere('d.propertyId = :propertyId', {
          propertyId: query.propertyId,
        });
      }
      return filtered;
    });
    const total = await base.clone().getCount();
    const items = await this.withNames(
      base
        .orderBy('d.createdAt', 'DESC')
        .addOrderBy('d.id', 'DESC')
        .offset(query.offset)
        .limit(query.pageSize),
    );
    return new Paginated(items, query.page, query.pageSize, total);
  }

  /**
   * Sửa giá chốt, tiền cọc, ngày cọc, ghi chú: chỉ đổi trường được gửi, trong transaction có khoá dòng.
   * Ngoài phạm vi xem → 404, ngoài phạm vi `deal.manage` → 403, `expectedUpdatedAt` lệch → 409. Giao dịch
   * đã WON thì không xoá được giá chốt (422).
   */
  async update(
    actor: Actor,
    id: string,
    dto: UpdateDealDto,
    scopes: DealScopes,
  ): Promise<DealResponse> {
    const patch: Record<string, unknown> = {};
    for (const field of EDITABLE_DEAL_FIELDS) {
      if (dto[field] !== undefined) {
        patch[field] = dto[field];
      }
    }
    if (Object.keys(patch).length === 0) {
      throw invalid([{ message: 'Cần gửi ít nhất một trường để cập nhật' }]);
    }
    await this.dataSource.transaction(async (manager) => {
      const current = await this.lockForManage(manager, actor, id, scopes);
      assertExpected(dto.expectedUpdatedAt, current);
      if (patch['dealPrice'] === null && requiresPrice(current.stage)) {
        throw new AppException(
          ErrorCode.BUSINESS_RULE_VIOLATION,
          'Giao dịch đã thành công phải có giá chốt',
        );
      }
      await this.deals.withManager(manager).update(actor.tenantId, id, {
        ...patch,
        updatedBy: actor.userId,
      } as TenantWritable<Deal>);
      const changes = diff(current, patch);
      if (changes) {
        await this.record(manager, actor, id, 'deal.update', changes);
      }
    });
    return this.findOne(actor, id, scopes);
  }

  /**
   * Chuyển bước giao dịch. Cần `deal.manage` (404/403 như khi sửa).
   * - Chuyển qua lại tự do giữa các bước (mở lại giao dịch đã đóng được), như pipeline khách.
   * - Sang WON bắt buộc đã có giá chốt (422).
   * - Vào WON/LOST thì ghi `closed_at` = lúc chuyển; về bước đang mở thì xoá `closed_at`.
   * - Đặt lại đúng bước đang có thì không ghi gì. Ghi `deal.change_stage` vào `audit_logs`.
   */
  async changeStage(
    actor: Actor,
    id: string,
    dto: ChangeDealStageDto,
    scopes: DealScopes,
  ): Promise<DealResponse> {
    await this.dataSource.transaction(async (manager) => {
      const current = await this.lockForManage(manager, actor, id, scopes);
      assertExpected(dto.expectedUpdatedAt, current);
      if (current.stage === dto.stage) {
        return;
      }
      if (requiresPrice(dto.stage) && current.dealPrice === null) {
        throw new AppException(
          ErrorCode.BUSINESS_RULE_VIOLATION,
          'Cần nhập giá chốt trước khi chuyển giao dịch sang thành công',
        );
      }
      const closedAt = CLOSED_DEAL_STAGES.includes(dto.stage) ? new Date() : null;
      await this.deals.withManager(manager).update(actor.tenantId, id, {
        stage: dto.stage,
        closedAt,
        updatedBy: actor.userId,
      });
      await this.record(manager, actor, id, 'deal.change_stage', {
        stage: [current.stage, dto.stage],
        ...(current.closedAt !== null || closedAt !== null
          ? { closedAt: [current.closedAt, closedAt] }
          : {}),
      });
    });
    return this.findOne(actor, id, scopes);
  }

  /** Xoá mềm giao dịch → 204. Ngoài phạm vi xem → 404, ngoài phạm vi `deal.manage` → 403. */
  async remove(actor: Actor, id: string, scopes: DealScopes): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.lockForManage(manager, actor, id, scopes);
      const deals = this.deals.withManager(manager);
      await deals.update(actor.tenantId, id, { updatedBy: actor.userId });
      await deals.softDelete(actor.tenantId, id);
      await this.record(manager, actor, id, 'deal.delete');
    });
  }

  /** Giao dịch trong phạm vi xem; `build` thêm điều kiện bằng andWhere. */
  private visible(
    actor: Actor,
    scopes: DealScopes,
    build: (query: SelectQueryBuilder<Deal>) => SelectQueryBuilder<Deal>,
  ): SelectQueryBuilder<Deal> {
    return this.deals
      .createQueryBuilder(actor.tenantId, 'd', (query) =>
        build(query.where(this.scopeOrFalse(scopes.view))),
      )
      .setParameter('scopeUserId', actor.userId);
  }

  /** Chạy truy vấn giao dịch, kèm tên khách và mã, tiêu đề BĐS (kể cả khách/BĐS đã xoá, để giữ lịch sử). */
  private async withNames(query: SelectQueryBuilder<Deal>): Promise<DealResponse[]> {
    const { entities, raw } = await query
      .innerJoin('customers', 'cu', 'cu.id = d.customer_id AND cu.tenant_id = d.tenant_id')
      .innerJoin('properties', 'pr', 'pr.id = d.property_id AND pr.tenant_id = d.tenant_id')
      .addSelect('cu.full_name', 'customer_name')
      .addSelect('pr.code', 'property_code')
      .addSelect('pr.title', 'property_title')
      .getRawAndEntities<NamesRow>();
    const names = new Map(raw.map((row) => [row.d_id, row]));
    return entities.map((deal) => {
      const row = names.get(deal.id);
      return {
        id: deal.id,
        customer: { id: deal.customerId, fullName: row?.customer_name ?? '' },
        property: {
          id: deal.propertyId,
          code: row?.property_code ?? '',
          title: row?.property_title ?? '',
        },
        agentId: deal.agentId,
        stage: deal.stage,
        dealPrice: deal.dealPrice,
        depositAmount: deal.depositAmount,
        depositAt: deal.depositAt,
        closedAt: deal.closedAt,
        notes: deal.notes,
        createdBy: deal.createdBy,
        updatedBy: deal.updatedBy,
        createdAt: deal.createdAt,
        updatedAt: deal.updatedAt,
      };
    });
  }

  /** Khoá dòng (FOR UPDATE) rồi kiểm quyền: ngoài phạm vi xem → 404, ngoài phạm vi quản lý → 403. */
  private async lockForManage(
    manager: EntityManager,
    actor: Actor,
    id: string,
    scopes: DealScopes,
  ): Promise<Deal> {
    const { entities, raw } = await this.deals
      .withManager(manager)
      .createQueryBuilder(actor.tenantId, 'd', (query) => query.where('d.id = :id', { id }))
      .addSelect(`(${this.scopeOrFalse(scopes.view)})`, 'in_view')
      .addSelect(`(${this.scopeOrFalse(scopes.manage)})`, 'in_action')
      .setParameter('scopeUserId', actor.userId)
      .setLock('pessimistic_write')
      .getRawAndEntities<{ in_view: boolean; in_action: boolean }>();
    const current = entities[0];
    if (!current || raw[0]?.in_view !== true) {
      throw notFound();
    }
    if (raw[0].in_action !== true) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Không có quyền thay đổi giao dịch này');
    }
    return current;
  }

  private async assertCustomer(actor: Actor, customerId: string, scopes: CustomerScopes) {
    try {
      await this.customers.findOne(actor, customerId, scopes);
    } catch (error) {
      throw asFieldError(error, 'customerId', 'Khách hàng không tồn tại hoặc bạn không xem được');
    }
  }

  private async assertProperty(actor: Actor, propertyId: string, scopes: PropertyScopes) {
    try {
      await this.properties.assertVisible(actor, propertyId, scopes);
    } catch (error) {
      throw asFieldError(error, 'propertyId', 'BĐS không tồn tại hoặc bạn không xem được');
    }
  }

  private record(
    manager: EntityManager,
    actor: Actor,
    dealId: string,
    action: `deal.${string}`,
    changes: AuditChanges | null = null,
  ): Promise<void> {
    return this.audit.record(manager, {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action,
      entityType: 'deal',
      entityId: dealId,
      changes,
    });
  }

  /** Điều kiện phạm vi, hoặc FALSE khi user không có quyền đó. */
  private scopeOrFalse(scope: PermissionScope | undefined): string {
    return scope ? scopeCondition(scope, DEAL_SCOPE_COLUMNS) : 'FALSE';
  }
}

function requiresPrice(stage: string): boolean {
  return PRICE_REQUIRED_STAGES.includes(stage as DealStage);
}

function assertExpected(expected: Date | undefined, current: Deal): void {
  if (expected && expected.getTime() !== current.updatedAt.getTime()) {
    throw new AppException(
      ErrorCode.CONFLICT,
      'Giao dịch đã được người khác cập nhật, vui lòng tải lại rồi thao tác lại',
    );
  }
}

/** Khách/BĐS không xem được (404) → lỗi dữ liệu của trường đó; lỗi khác giữ nguyên. */
function asFieldError(error: unknown, field: string, message: string): unknown {
  if (error instanceof AppException && error.code === ErrorCode.NOT_FOUND) {
    return invalid([{ field, message }]);
  }
  return error;
}

/** `{ field: [cũ, mới] }` cho các trường thật sự đổi giá trị; không đổi gì → null. */
function diff(current: Deal, patch: Record<string, unknown>): AuditChanges | null {
  const changes: AuditChanges = {};
  for (const [field, next] of Object.entries(patch)) {
    const previous = (current as unknown as Record<string, unknown>)[field] ?? null;
    if (JSON.stringify(previous) !== JSON.stringify(next ?? null)) {
      changes[field] = [previous, next ?? null];
    }
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

function notFound(): AppException {
  return new AppException(ErrorCode.NOT_FOUND, 'Không tìm thấy giao dịch');
}

function invalid(details: ErrorDetail[]): AppException {
  return new AppException(ErrorCode.VALIDATION_ERROR, undefined, details);
}
