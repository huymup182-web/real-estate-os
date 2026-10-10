import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository, type SelectQueryBuilder } from 'typeorm';

import { type AuditChanges, AuditService } from '../audit/audit.service.js';
import type { PermissionScope } from '../auth/permission.service.js';
import { scopeCondition } from '../auth/record-scope.js';
import { AppException, type ErrorDetail } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { Paginated } from '../common/response/paginated.js';
import { TenantRepository, type TenantWritable } from '../database/tenant.repository.js';
import type { Actor } from '../properties/properties.service.js';
import { insertCustomerActivity } from './customer-activity.record.js';
import {
  ACTIVITY_TYPES,
  CLOSED_CUSTOMER_STATUSES,
  CUSTOMER_SOURCES,
  CUSTOMER_STATUSES,
  DASHBOARD_DEFAULT_DAYS,
  DASHBOARD_MAX_DAYS,
  FOLLOW_UP_AFTER_DAYS,
  canChangeCustomerStatus,
} from './customer-values.js';
import { Customer } from './customer.entity.js';
import { type CustomerResponse, toCustomerResponse } from './customer.response.js';
import type { AssignCustomerDto } from './dto/assign-customer.dto.js';
import type { ChangeCustomerStatusDto } from './dto/change-customer-status.dto.js';
import type { CreateCustomerDto } from './dto/create-customer.dto.js';
import type { CustomerDashboardQueryDto } from './dto/customer-dashboard-query.dto.js';
import type { CustomerListQueryDto } from './dto/customer-list-query.dto.js';
import { EDITABLE_CUSTOMER_FIELDS, type UpdateCustomerDto } from './dto/update-customer.dto.js';

/** Phạm vi các quyền khách hàng của user, lấy từ `req.user.permissions`. Không có key = không có quyền. */
/** Một khách cần chăm sóc (TASK-141). */
export interface FollowUpCandidate {
  id: string;
  fullName: string;
  status: string;
  purpose: string | null;
  purchaseTimeline: string | null;
  agentId: string | null;
  /** Lần chăm sóc gần nhất (hoạt động mới nhất, hoặc lúc tạo khách nếu chưa có hoạt động). */
  lastContactAt: Date;
  lastActivity: { type: string; content: string | null; occurredAt: Date } | null;
  /** Số nhu cầu đang bật. */
  activeNeeds: number;
}

export interface CustomerScopes {
  view: PermissionScope | undefined;
  edit: PermissionScope | undefined;
  delete: PermissionScope | undefined;
  assign: PermissionScope | undefined;
}

const DAY_MS = 24 * 3600 * 1000;

/** Số liệu dashboard khách hàng (TASK-085). */
export interface CustomerDashboard {
  period: { from: Date; to: Date };
  totalCustomers: number;
  newCustomers: number;
  followUpNeeded: number;
  wonCustomers: number;
  lostCustomers: number;
  pipeline: { status: string; count: number }[];
  sources: { source: string | null; count: number }[];
  activities: { type: string; count: number }[];
}

/** Cột xét phạm vi của khách hàng: môi giới phụ trách và người tạo. */
const CUSTOMER_SCOPE_COLUMNS = { agent: 'c.agent_id', creator: 'c.created_by' };

/** Xét người nhận khách `u` như người phụ trách của bản ghi (OWN = chính mình). */
const AGENT_SCOPE_COLUMNS = { agent: 'u.id', creator: 'u.id' };

/** `{ field: [cũ, mới] }` cho các trường thật sự đổi giá trị; không đổi gì → null. */
function diff(current: Customer, patch: Record<string, unknown>): AuditChanges | null {
  const changes: AuditChanges = {};
  for (const [field, next] of Object.entries(patch)) {
    const previous = (current as unknown as Record<string, unknown>)[field] ?? null;
    if (JSON.stringify(previous) !== JSON.stringify(next ?? null)) {
      changes[field] = [previous, next ?? null];
    }
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

/**
 * Khách hàng (TASK-077). Quyền theo phase0/04-RBAC.md: `customer.view/create/edit/delete`, phạm vi xét
 * theo môi giới phụ trách hoặc người tạo (OWN, TEAM, DEPARTMENT, COMPANY).
 */
@Injectable()
export class CustomersService {
  private readonly customers: TenantRepository<Customer>;

  constructor(
    @InjectRepository(Customer) repository: Repository<Customer>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {
    this.customers = new TenantRepository(repository);
  }

  /** Tạo khách hàng: người tạo là môi giới phụ trách, trạng thái NEW. */
  async create(actor: Actor, dto: CreateCustomerDto): Promise<CustomerResponse> {
    const customer = await this.dataSource.transaction(async (manager) => {
      const created = await this.customers.withManager(manager).create(actor.tenantId, {
        fullName: dto.fullName,
        phone: dto.phone,
        email: dto.email ?? null,
        purpose: dto.purpose ?? null,
        purchaseTimeline: dto.purchaseTimeline ?? null,
        source: dto.source ?? null,
        notes: dto.notes ?? null,
        agentId: actor.userId,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
      await this.recordActivity(manager, actor, created.id, 'customer.create');
      return created;
    });
    return toCustomerResponse(customer);
  }

  /** Chi tiết khách hàng. Ngoài phạm vi `customer.view`, đã xoá hoặc công ty khác → 404. */
  async findOne(actor: Actor, id: string, scopes: CustomerScopes): Promise<CustomerResponse> {
    const customer = await this.customers
      .createQueryBuilder(actor.tenantId, 'c', (query) =>
        query.where('c.id = :id', { id }).andWhere(this.scopeOrFalse(scopes.view)),
      )
      .setParameter('scopeUserId', actor.userId)
      .getOne();
    if (!customer) {
      throw notFound();
    }
    return toCustomerResponse(customer);
  }

  /**
   * Danh sách khách hàng trong phạm vi `customer.view`, mới tạo trước, phân trang offset; `status` lọc theo
   * bước pipeline (TASK-082), `q` tìm theo tên, số điện thoại, email (TASK-108).
   */
  async findAll(
    actor: Actor,
    query: CustomerListQueryDto,
    scopes: CustomerScopes,
  ): Promise<Paginated<CustomerResponse>> {
    const [customers, total] = await this.customers
      .createQueryBuilder(actor.tenantId, 'c', (builder) => {
        let visible = builder.where(this.scopeOrFalse(scopes.view));
        if (query.status) {
          visible = visible.andWhere('c.status IN (:...statuses)', { statuses: query.status });
        }
        return query.q ? visible.andWhere(...keywordCondition(query.q)) : visible;
      })
      .setParameter('scopeUserId', actor.userId)
      .orderBy('c.createdAt', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .offset(query.offset)
      .limit(query.pageSize)
      .getManyAndCount();
    return new Paginated(customers.map(toCustomerResponse), query.page, query.pageSize, total);
  }

  /**
   * Sửa khách hàng: chỉ đổi trường được gửi, trong transaction có khoá dòng. Ngoài phạm vi xem → 404;
   * xem được nhưng ngoài phạm vi `customer.edit` → 403; `expectedUpdatedAt` lệch → 409.
   */
  async update(
    actor: Actor,
    id: string,
    dto: UpdateCustomerDto,
    scopes: CustomerScopes,
  ): Promise<CustomerResponse> {
    const patch: Record<string, unknown> = {};
    for (const field of EDITABLE_CUSTOMER_FIELDS) {
      if (dto[field] !== undefined) {
        patch[field] = dto[field];
      }
    }
    if (Object.keys(patch).length === 0) {
      throw invalid([{ message: 'Cần gửi ít nhất một trường để cập nhật' }]);
    }

    await this.dataSource.transaction(async (manager) => {
      const customers = this.customers.withManager(manager);
      const current = await this.lockForAction(
        manager,
        actor,
        id,
        scopes,
        scopes.edit,
        'Không có quyền sửa khách hàng này',
      );
      assertNotModified(current, dto.expectedUpdatedAt);
      await customers.update(actor.tenantId, id, {
        ...patch,
        updatedBy: actor.userId,
      } as TenantWritable<Customer>);
      const changes = diff(current, patch);
      if (changes) {
        await this.recordActivity(manager, actor, id, 'customer.update', changes);
      }
    });

    return this.findOne(actor, id, scopes);
  }

  /**
   * Xoá mềm khách hàng → 204. Ngoài phạm vi xem → 404; ngoài phạm vi `customer.delete` → 403.
   * Ghi người xoá vào `updated_by`; nhu cầu, lịch hẹn, giao dịch của khách giữ nguyên.
   */
  async remove(actor: Actor, id: string, scopes: CustomerScopes): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const customers = this.customers.withManager(manager);
      await this.lockForAction(
        manager,
        actor,
        id,
        scopes,
        scopes.delete,
        'Không có quyền xoá khách hàng này',
      );
      await customers.update(actor.tenantId, id, { updatedBy: actor.userId });
      await customers.softDelete(actor.tenantId, id);
      await this.recordActivity(manager, actor, id, 'customer.delete');
    });
  }

  /**
   * Số khách ở từng bước pipeline trong phạm vi `customer.view` (TASK-082), đủ mọi bước theo thứ tự
   * (bước không có khách = 0).
   */
  async pipeline(
    actor: Actor,
    scopes: CustomerScopes,
  ): Promise<{ status: string; count: number }[]> {
    const rows = await this.customers
      .createQueryBuilder(actor.tenantId, 'c', (builder) =>
        builder.where(this.scopeOrFalse(scopes.view)),
      )
      .setParameter('scopeUserId', actor.userId)
      .select('c.status', 'status')
      .addSelect('count(*)::int', 'count')
      .groupBy('c.status')
      .getRawMany<{ status: string; count: number }>();
    const counts = new Map(rows.map((row) => [row.status, row.count]));
    return CUSTOMER_STATUSES.map((status) => ({ status, count: counts.get(status) ?? 0 }));
  }

  /**
   * Dashboard khách hàng trong phạm vi `customer.view` (TASK-085). Kỳ `[from, to)` mặc định 30 ngày gần
   * nhất, dài nhất 366 ngày; `from` ≥ `to` hoặc kỳ quá dài → 400.
   * - `totalCustomers`, `pipeline`, `sources`: theo hiện trạng; `followUpNeeded`: khách chưa WON/LOST
   *   không có hoạt động nào (tính cả lúc tạo) trong `FOLLOW_UP_AFTER_DAYS` ngày tới bây giờ.
   * - `newCustomers`: tạo trong kỳ; `activities`: số hoạt động theo loại trong kỳ; `wonCustomers`,
   *   `lostCustomers`: số khách được chuyển sang WON/LOST trong kỳ.
   */
  async dashboard(
    actor: Actor,
    query: CustomerDashboardQueryDto,
    scopes: CustomerScopes,
  ): Promise<CustomerDashboard> {
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getTime() - DASHBOARD_DEFAULT_DAYS * DAY_MS);
    if (from.getTime() >= to.getTime()) {
      throw invalid([{ field: 'to', message: 'to phải sau from' }]);
    }
    if (to.getTime() - from.getTime() > DASHBOARD_MAX_DAYS * DAY_MS) {
      throw invalid([
        { field: 'from', message: `Kỳ thống kê dài nhất ${DASHBOARD_MAX_DAYS} ngày` },
      ]);
    }
    const visible = (): SelectQueryBuilder<Customer> => this.visible(actor, scopes);

    const [totals] = await visible()
      .select('count(*)::int', 'total')
      .addSelect(
        '(count(*) FILTER (WHERE c.created_at >= :from AND c.created_at < :to))::int',
        'new',
      )
      .addSelect(
        `(count(*) FILTER (WHERE c.status NOT IN (:...closed) AND GREATEST(c.created_at, (
            SELECT max(ca.occurred_at) FROM customer_activities ca
             WHERE ca.tenant_id = c.tenant_id AND ca.customer_id = c.id
          )) < :followUpBefore))::int`,
        'followUp',
      )
      .setParameters({
        from,
        to,
        closed: [...CLOSED_CUSTOMER_STATUSES],
        followUpBefore: new Date(Date.now() - FOLLOW_UP_AFTER_DAYS * DAY_MS),
      })
      .getRawMany<{ total: number; new: number; followUp: number }>();

    const sourceRows = await visible()
      .select('c.source', 'source')
      .addSelect('count(*)::int', 'count')
      .groupBy('c.source')
      .getRawMany<{ source: string | null; count: number }>();
    const sourceCounts = new Map(sourceRows.map((row) => [row.source, row.count]));

    const ids = visible().select('c.id');
    const activityRows = (await this.dataSource.query(
      ...this.inPeriod(
        ids,
        `SELECT ca.type, count(*)::int AS count, count(DISTINCT ca.customer_id) FILTER (
                  WHERE ca.type = 'STATUS_CHANGE' AND ca.metadata->>'toStatus' = 'WON')::int AS won,
                count(DISTINCT ca.customer_id) FILTER (
                  WHERE ca.type = 'STATUS_CHANGE' AND ca.metadata->>'toStatus' = 'LOST')::int AS lost
           FROM customer_activities ca`,
        'GROUP BY ca.type',
        from,
        to,
      ),
    )) as { type: string; count: number; won: number; lost: number }[];
    const activityCounts = new Map(activityRows.map((row) => [row.type, row.count]));
    const statusChanges = activityRows.find((row) => row.type === 'STATUS_CHANGE');

    return {
      period: { from, to },
      totalCustomers: totals?.total ?? 0,
      newCustomers: totals?.new ?? 0,
      followUpNeeded: totals?.followUp ?? 0,
      wonCustomers: statusChanges?.won ?? 0,
      lostCustomers: statusChanges?.lost ?? 0,
      pipeline: await this.pipeline(actor, scopes),
      sources: [...CUSTOMER_SOURCES, null].map((source) => ({
        source,
        count: sourceCounts.get(source) ?? 0,
      })),
      activities: ACTIVITY_TYPES.map((type) => ({ type, count: activityCounts.get(type) ?? 0 })),
    };
  }

  /**
   * Truy vấn khách (alias `c`) trong phạm vi `customer.view`, đã có điều kiện công ty và bỏ khách đã xoá;
   * thêm điều kiện bằng andWhere. Dùng cho dashboard và matching (TASK-087).
   */
  /**
   * Khách cần chăm sóc (TASK-141), cùng luật với `followUpNeeded` của dashboard: chưa WON/LOST, không có hoạt
   * động nào (tính cả lúc tạo) trong `FOLLOW_UP_AFTER_DAYS` ngày. Khách ở bước gần chốt hơn đứng trước, cùng
   * bước thì lâu chưa chăm sóc hơn đứng trước. Tối đa [limit] khách, kèm hoạt động gần nhất và số nhu cầu đang bật.
   */
  async followUps(
    actor: Actor,
    scopes: CustomerScopes,
    limit: number,
  ): Promise<FollowUpCandidate[]> {
    const lastContact = `GREATEST(c.created_at, (
        SELECT max(ca.occurred_at) FROM customer_activities ca
         WHERE ca.tenant_id = c.tenant_id AND ca.customer_id = c.id))`;
    const rows = await this.visible(actor, scopes)
      .select('c.id', 'id')
      .addSelect('c.full_name', 'fullName')
      .addSelect('c.status', 'status')
      .addSelect('c.purpose', 'purpose')
      .addSelect('c.purchase_timeline', 'purchaseTimeline')
      .addSelect('c.agent_id', 'agentId')
      .addSelect(lastContact, 'lastContactAt')
      .addSelect('array_position(CAST(:statuses AS text[]), c.status)', 'step')
      .andWhere('c.status NOT IN (:...closed)')
      .andWhere(`${lastContact} < :followUpBefore`)
      .setParameters({
        statuses: [...CUSTOMER_STATUSES],
        closed: [...CLOSED_CUSTOMER_STATUSES],
        followUpBefore: new Date(Date.now() - FOLLOW_UP_AFTER_DAYS * DAY_MS),
      })
      .orderBy('step', 'DESC')
      .addOrderBy('"lastContactAt"', 'ASC')
      .addOrderBy('c.id', 'ASC')
      .limit(limit)
      .getRawMany<Omit<FollowUpCandidate, 'lastActivity' | 'activeNeeds'>>();
    if (rows.length === 0) {
      return [];
    }

    const ids = rows.map((row) => row.id);
    const activities = (await this.dataSource.query(
      `SELECT DISTINCT ON (customer_id) customer_id, type, content, occurred_at
         FROM customer_activities WHERE tenant_id = $1 AND customer_id = ANY($2::uuid[])
        ORDER BY customer_id, occurred_at DESC, created_at DESC`,
      [actor.tenantId, ids],
    )) as { customer_id: string; type: string; content: string | null; occurred_at: Date }[];
    const needs = (await this.dataSource.query(
      `SELECT customer_id, count(*)::int AS count FROM customer_preferences
        WHERE tenant_id = $1 AND customer_id = ANY($2::uuid[]) AND is_active GROUP BY customer_id`,
      [actor.tenantId, ids],
    )) as { customer_id: string; count: number }[];
    const lastActivity = new Map(activities.map((row) => [row.customer_id, row]));
    const activeNeeds = new Map(needs.map((row) => [row.customer_id, row.count]));

    return rows.map(
      ({ id, fullName, status, purpose, purchaseTimeline, agentId, lastContactAt }) => {
        const activity = lastActivity.get(id);
        return {
          id,
          fullName,
          status,
          purpose,
          purchaseTimeline,
          agentId,
          lastContactAt: new Date(lastContactAt),
          lastActivity: activity
            ? { type: activity.type, content: activity.content, occurredAt: activity.occurred_at }
            : null,
          activeNeeds: activeNeeds.get(id) ?? 0,
        };
      },
    );
  }

  visible(actor: Actor, scopes: CustomerScopes): SelectQueryBuilder<Customer> {
    return this.customers
      .createQueryBuilder(actor.tenantId, 'c', (builder) =>
        builder.where(this.scopeOrFalse(scopes.view)),
      )
      .setParameter('scopeUserId', actor.userId);
  }

  /**
   * SQL thô trên `customer_activities ca` của khách trong `ids` (truy vấn khách xem được, đã có điều kiện
   * công ty), hoạt động trong kỳ `[from, to)`.
   */
  private inPeriod(
    ids: SelectQueryBuilder<Customer>,
    select: string,
    tail: string,
    from: Date,
    to: Date,
  ): [string, unknown[]] {
    const [idsSql, idsParams] = ids.getQueryAndParameters();
    const next = idsParams.length;
    return [
      `${select}
        WHERE ca.customer_id IN (${idsSql})
          AND ca.occurred_at >= $${next + 1} AND ca.occurred_at < $${next + 2}
        ${tail}`,
      [...idsParams, from, to],
    ];
  }

  /**
   * Chuyển khách sang bước pipeline khác (TASK-082). Cần `customer.edit` với khách (404/403 như khi sửa).
   * - Sang LOST bắt buộc `lostReason` (lưu vào khách); rời LOST thì xoá lý do cũ. `lostReason` gửi kèm
   *   bước khác → 400.
   * - Luật chuyển bước: `canChangeCustomerStatus` (hiện cho chuyển tự do).
   * - Đặt lại đúng bước đang có thì không đổi gì; LOST → LOST với lý do mới thì cập nhật lý do.
   * - Ghi `customer.change_status` vào `audit_logs` và một dòng STATUS_CHANGE lên timeline của khách.
   */
  async changeStatus(
    actor: Actor,
    id: string,
    dto: ChangeCustomerStatusDto,
    scopes: CustomerScopes,
  ): Promise<CustomerResponse> {
    if (dto.status !== 'LOST' && dto.lostReason !== undefined) {
      throw invalid([{ field: 'lostReason', message: 'lostReason chỉ gửi khi chuyển sang LOST' }]);
    }
    await this.dataSource.transaction(async (manager) => {
      const current = await this.lockForAction(
        manager,
        actor,
        id,
        scopes,
        scopes.edit,
        'Không có quyền đổi trạng thái khách hàng này',
      );
      assertNotModified(current, dto.expectedUpdatedAt);
      const lostReason = dto.status === 'LOST' ? (dto.lostReason ?? null) : null;
      if (current.status === dto.status && current.lostReason === lostReason) {
        return;
      }
      if (!canChangeCustomerStatus(current.status, dto.status)) {
        throw new AppException(
          ErrorCode.BUSINESS_RULE_VIOLATION,
          `Không chuyển được khách từ ${current.status} sang ${dto.status}`,
        );
      }
      await this.customers.withManager(manager).update(actor.tenantId, id, {
        status: dto.status,
        lostReason,
        updatedBy: actor.userId,
      });
      const changes = diff(current, { status: dto.status, lostReason });
      if (changes) {
        await this.recordActivity(manager, actor, id, 'customer.change_status', changes);
      }
      await insertCustomerActivity(manager, {
        tenantId: actor.tenantId,
        customerId: id,
        userId: actor.userId,
        type: 'STATUS_CHANGE',
        content: lostReason,
        metadata: { fromStatus: current.status, toStatus: dto.status },
      });
    });
    return this.findOne(actor, id, scopes);
  }

  /**
   * Đổi môi giới phụ trách khách (TASK-079), cần `customer.assign` (phase0/04-RBAC.md), cùng luật như
   * phân BĐS (TASK-056):
   * - Khách ngoài phạm vi xem → 404; xem được nhưng ngoài phạm vi `customer.assign` → 403.
   * - Người nhận phải là user đang hoạt động của cùng công ty (không có → 400 `agentId`) và nằm trong
   *   cùng phạm vi đó (TEAM: cùng nhóm, DEPARTMENT: cùng phòng, COMPANY: cả công ty), ngoài phạm vi → 403.
   * - Giao lại đúng người đang phụ trách thì không đổi gì. Trả về khách sau khi giao.
   */
  async assign(
    actor: Actor,
    id: string,
    dto: AssignCustomerDto,
    scopes: CustomerScopes,
  ): Promise<CustomerResponse> {
    await this.dataSource.transaction(async (manager) => {
      const current = await this.lockForAction(
        manager,
        actor,
        id,
        scopes,
        scopes.assign,
        'Không có quyền phân khách hàng này',
      );
      assertNotModified(current, dto.expectedUpdatedAt);
      if (current.agentId === dto.agentId) {
        return;
      }
      await this.assertAssignableAgent(manager, actor, dto.agentId, scopes.assign);
      await this.customers.withManager(manager).update(actor.tenantId, id, {
        agentId: dto.agentId,
        updatedBy: actor.userId,
      });
      await this.recordActivity(manager, actor, id, 'customer.assign', {
        agentId: [current.agentId, dto.agentId],
      });
      // Timeline của khách (TASK-081).
      await insertCustomerActivity(manager, {
        tenantId: actor.tenantId,
        customerId: id,
        userId: actor.userId,
        type: 'ASSIGNMENT',
        metadata: { fromAgentId: current.agentId, toAgentId: dto.agentId },
      });
    });
    return this.findOne(actor, id, scopes);
  }

  /** Ghi một hoạt động của khách vào `audit_logs`, trong transaction của thao tác. */
  recordActivity(
    manager: EntityManager,
    actor: Actor,
    customerId: string,
    action: `customer.${string}`,
    changes: AuditChanges | null = null,
  ): Promise<void> {
    return this.audit.record(manager, {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action,
      entityType: 'customer',
      entityId: customerId,
      changes,
    });
  }

  /**
   * Khoá dòng khách (FOR UPDATE) rồi kiểm quyền theo bản ghi: ngoài phạm vi xem → 404, ngoài phạm vi
   * thao tác → 403. Dùng chung cho nhu cầu của khách (TASK-078).
   */
  async lockForAction(
    manager: EntityManager,
    actor: Actor,
    id: string,
    scopes: CustomerScopes,
    actionScope: PermissionScope | undefined,
    forbiddenMessage: string,
  ): Promise<Customer> {
    const { entities, raw } = await this.customers
      .withManager(manager)
      .createQueryBuilder(actor.tenantId, 'c', (query) => query.where('c.id = :id', { id }))
      .addSelect(`(${this.scopeOrFalse(scopes.view)})`, 'in_view')
      .addSelect(`(${this.scopeOrFalse(actionScope)})`, 'in_action')
      .setParameter('scopeUserId', actor.userId)
      .setLock('pessimistic_write')
      .getRawAndEntities<{ in_view: boolean; in_action: boolean }>();
    const current = entities[0];
    if (!current || raw[0]?.in_view !== true) {
      throw notFound();
    }
    if (raw[0].in_action !== true) {
      throw new AppException(ErrorCode.FORBIDDEN, forbiddenMessage);
    }
    return current;
  }

  /** Người nhận khách: user đang hoạt động của công ty và trong phạm vi phân khách của người giao. */
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
        'Không được giao khách cho người ngoài phạm vi quản lý của mình',
      );
    }
  }

  /** Điều kiện phạm vi, hoặc FALSE khi user không có quyền đó. */
  private scopeOrFalse(
    scope: PermissionScope | undefined,
    columns = CUSTOMER_SCOPE_COLUMNS,
  ): string {
    return scope ? scopeCondition(scope, columns) : 'FALSE';
  }
}

/** `expectedUpdatedAt` client gửi khác `updatedAt` hiện tại → 409 (phase0/05-API-CONVENTIONS.md mục 8). */
function assertNotModified(current: Customer, expectedUpdatedAt: Date | undefined): void {
  if (expectedUpdatedAt && expectedUpdatedAt.getTime() !== current.updatedAt.getTime()) {
    throw new AppException(
      ErrorCode.CONFLICT,
      'Khách hàng đã được người khác cập nhật, vui lòng tải lại rồi thao tác lại',
    );
  }
}

function notFound(): AppException {
  return new AppException(ErrorCode.NOT_FOUND, 'Không tìm thấy khách hàng');
}

function invalid(details: ErrorDetail[]): AppException {
  return new AppException(ErrorCode.VALIDATION_ERROR, undefined, details);
}

/**
 * Điều kiện tìm khách theo từ khoá (TASK-108): tên hoặc email chứa `q` (không phân biệt hoa thường), hoặc số
 * điện thoại chứa các chữ số của `q`. SĐT lưu dạng quốc tế nên số 0 đầu bị bỏ: "0901 234" khớp "+84901234…".
 */
function keywordCondition(q: string): [string, Record<string, string>] {
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const digits = q.replace(/\D/g, '').replace(/^0/, '');
  const conditions = [
    `c.fullName ILIKE :keyword ESCAPE '\\'`,
    `c.email::text ILIKE :keyword ESCAPE '\\'`,
  ];
  if (digits.length >= 3) {
    conditions.push('c.phone LIKE :phoneDigits');
  }
  return [`(${conditions.join(' OR ')})`, { keyword: like, phoneDigits: `%${digits}%` }];
}
