import { Injectable } from '@nestjs/common';
import { DataSource, type SelectQueryBuilder } from 'typeorm';

import type { PermissionScope } from '../auth/permission.service.js';
import { type ScopeColumns, scopeCondition } from '../auth/record-scope.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import {
  CUSTOMER_STATUSES,
  type CustomerStatus,
  DASHBOARD_DEFAULT_DAYS,
  DASHBOARD_MAX_DAYS,
} from '../customers/customer-values.js';
import { assertTenant } from '../database/tenant.repository.js';
import type { Actor } from '../properties/properties.service.js';
import type { DashboardQueryDto } from './dto/dashboard-query.dto.js';

/** Các bước của giao dịch (bảng deals, TASK-023), theo thứ tự phễu. */
export const DEAL_STAGES = ['NEGOTIATING', 'DEPOSIT', 'CONTRACT', 'WON', 'LOST'] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

const DAY_MS = 24 * 3600 * 1000;

export interface Dashboard {
  period: { from: Date; to: Date };
  /** Phạm vi `report.view` của người xem: số liệu chỉ tính bản ghi trong phạm vi này. */
  scope: PermissionScope;
  properties: { total: number; new: number; active: number };
  customers: { total: number; new: number };
  viewings: number;
  deals: { new: number; won: number; revenue: number };
  agents: number;
  leadFunnel: { status: CustomerStatus; count: number }[];
  salesFunnel: { stage: DealStage; count: number; value: number }[];
}

/**
 * Số liệu tổng hợp cho dashboard quản trị (TASK-102, phase0/01-PRD.md US-40). Module `reports` chỉ đọc
 * (phase0/02-ARCHITECTURE.md mục 2.1).
 */
@Injectable()
export class ReportsService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Dashboard trong phạm vi `report.view` (OWN/TEAM/DEPARTMENT theo người phụ trách hoặc người tạo; COMPANY
   * là cả công ty). Kỳ `[from, to)` mặc định 30 ngày gần nhất, dài nhất 366 ngày.
   * - BĐS: `total` hiện có, `new` tạo trong kỳ, `active` đang bán (AVAILABLE).
   * - Khách: `total` hiện có, `new` (lead mới) tạo trong kỳ.
   * - `viewings`: lịch dẫn khách hẹn trong kỳ, trừ lịch đã huỷ.
   * - Giao dịch: `new` tạo trong kỳ; `won` chốt thành công (WON) trong kỳ theo `closed_at`; `revenue` là tổng
   *   giá trị (deal_price) của các giao dịch `won` đó (Huy Lê chọn 2026-10-09).
   * - `agents`: người dùng đang hoạt động trong phạm vi.
   * - `leadFunnel`: khách hiện có theo trạng thái; `salesFunnel`: giao dịch hiện có theo bước, kèm tổng giá trị.
   */
  async dashboard(
    actor: Actor,
    query: DashboardQueryDto,
    scope: PermissionScope,
  ): Promise<Dashboard> {
    assertTenant(actor.tenantId);
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getTime() - DASHBOARD_DEFAULT_DAYS * DAY_MS);
    if (from.getTime() >= to.getTime()) {
      throw invalid('to', 'to phải sau from');
    }
    if (to.getTime() - from.getTime() > DASHBOARD_MAX_DAYS * DAY_MS) {
      throw invalid('from', `Kỳ thống kê dài nhất ${DASHBOARD_MAX_DAYS} ngày`);
    }
    const period = { from, to };
    const inPeriod = (column: string): string => `${column} >= :from AND ${column} < :to`;

    const [properties, customers, viewings, deals, agents, statusRows, stageRows] =
      await Promise.all([
        this.scoped(actor, scope, 'properties', 'p')
          .select('count(*)::int', 'total')
          .addSelect(`(count(*) FILTER (WHERE ${inPeriod('p.created_at')}))::int`, 'new')
          .addSelect(`(count(*) FILTER (WHERE p.status = 'AVAILABLE'))::int`, 'active')
          .setParameters(period)
          .getRawOne<{ total: number; new: number; active: number }>(),
        this.scoped(actor, scope, 'customers', 'c')
          .select('count(*)::int', 'total')
          .addSelect(`(count(*) FILTER (WHERE ${inPeriod('c.created_at')}))::int`, 'new')
          .setParameters(period)
          .getRawOne<{ total: number; new: number }>(),
        this.scoped(actor, scope, 'appointments', 'a')
          .select('count(*)::int', 'count')
          .andWhere(inPeriod('a.scheduled_at'))
          .andWhere(`a.status <> 'CANCELLED'`)
          .setParameters(period)
          .getRawOne<{ count: number }>(),
        this.scoped(actor, scope, 'deals', 'd')
          .select(`(count(*) FILTER (WHERE ${inPeriod('d.created_at')}))::int`, 'new')
          .addSelect(
            `(count(*) FILTER (WHERE d.stage = 'WON' AND ${inPeriod('d.closed_at')}))::int`,
            'won',
          )
          .addSelect(
            `(coalesce(sum(d.deal_price) FILTER (
                WHERE d.stage = 'WON' AND ${inPeriod('d.closed_at')}), 0))::text`,
            'revenue',
          )
          .setParameters(period)
          .getRawOne<{ new: number; won: number; revenue: string }>(),
        this.scoped(actor, scope, 'users', 'u', { agent: 'u.id', creator: 'u.id' })
          .select('count(*)::int', 'count')
          .andWhere(`u.status = 'ACTIVE'`)
          .getRawOne<{ count: number }>(),
        this.scoped(actor, scope, 'customers', 'c')
          .select('c.status', 'status')
          .addSelect('count(*)::int', 'count')
          .groupBy('c.status')
          .getRawMany<{ status: CustomerStatus; count: number }>(),
        this.scoped(actor, scope, 'deals', 'd')
          .select('d.stage', 'stage')
          .addSelect('count(*)::int', 'count')
          .addSelect('(coalesce(sum(d.deal_price), 0))::text', 'value')
          .groupBy('d.stage')
          .getRawMany<{ stage: DealStage; count: number; value: string }>(),
      ]);

    const statusCounts = new Map(statusRows.map((row) => [row.status, row.count]));
    const stages = new Map(stageRows.map((row) => [row.stage, row]));
    return {
      period,
      scope,
      properties: {
        total: properties?.total ?? 0,
        new: properties?.new ?? 0,
        active: properties?.active ?? 0,
      },
      customers: { total: customers?.total ?? 0, new: customers?.new ?? 0 },
      viewings: viewings?.count ?? 0,
      deals: {
        new: deals?.new ?? 0,
        won: deals?.won ?? 0,
        revenue: Number(deals?.revenue ?? 0),
      },
      agents: agents?.count ?? 0,
      leadFunnel: CUSTOMER_STATUSES.map((status) => ({
        status,
        count: statusCounts.get(status) ?? 0,
      })),
      salesFunnel: DEAL_STAGES.map((stage) => ({
        stage,
        count: stages.get(stage)?.count ?? 0,
        value: Number(stages.get(stage)?.value ?? 0),
      })),
    };
  }

  /**
   * Truy vấn bảng `table` (alias `alias`) của công ty người xem, bỏ bản ghi đã xoá, chỉ lấy bản ghi trong
   * phạm vi `scope`. Tên bảng, alias và cột là hằng số trong code, không lấy từ input.
   */
  private scoped(
    actor: Actor,
    scope: PermissionScope,
    table: string,
    alias: string,
    columns: ScopeColumns = { agent: `${alias}.agent_id`, creator: `${alias}.created_by` },
  ): SelectQueryBuilder<Record<string, unknown>> {
    return this.dataSource
      .createQueryBuilder()
      .from(table, alias)
      .where(`${alias}.tenant_id = :tenantId`, { tenantId: actor.tenantId })
      .andWhere(`${alias}.deleted_at IS NULL`)
      .andWhere(scopeCondition(scope, columns))
      .setParameter('scopeUserId', actor.userId);
  }
}

function invalid(field: string, message: string): AppException {
  return new AppException(ErrorCode.VALIDATION_ERROR, undefined, [{ field, message }]);
}
