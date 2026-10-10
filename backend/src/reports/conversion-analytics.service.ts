import { Injectable } from '@nestjs/common';

import type { PermissionScope } from '../auth/permission.service.js';
import { CUSTOMER_SOURCES } from '../customers/customer-values.js';
import { assertTenant } from '../database/tenant.repository.js';
import type { Actor } from '../properties/properties.service.js';
import type { DashboardQueryDto } from './dto/dashboard-query.dto.js';
import { ReportsService, reportPeriod } from './reports.service.js';

/** Hoạt động coi là đã liên hệ khách (không tính ghi chú, đổi trạng thái, giao khách). */
export const CONTACT_ACTIVITY_TYPES = [
  'CALL',
  'MESSAGE',
  'PROPERTY_SENT',
  'VIEWING',
  'NEGOTIATION',
  'DEPOSIT',
] as const;

/** Các bước phễu chuyển đổi, theo thứ tự. Mỗi bước tính khách đã tới bước đó hoặc xa hơn. */
export const CONVERSION_STEPS = ['LEAD', 'CONTACTED', 'VIEWED', 'NEGOTIATED', 'WON'] as const;
export type ConversionStep = (typeof CONVERSION_STEPS)[number];

export interface ConversionFunnelStep {
  step: ConversionStep;
  count: number;
  /** % so với số lead; null khi không có lead. */
  rateFromLead: number | null;
  /** % so với bước trước; null ở bước đầu hoặc khi bước trước bằng 0. */
  rateFromPrevious: number | null;
}

export interface ConversionGroup {
  /** Nguồn khách (null = chưa ghi nguồn) hoặc mã người phụ trách (null = chưa giao). */
  key: string | null;
  /** Tên người phụ trách; null khi chia theo nguồn. */
  name: string | null;
  leads: number;
  contacted: number;
  won: number;
  /** won / leads, %. */
  conversionRate: number | null;
}

export interface ConversionAnalytics {
  period: { from: Date; to: Date };
  scope: PermissionScope;
  funnel: ConversionFunnelStep[];
  /** Khách của nhóm đã chuyển sang Thất bại. */
  lost: number;
  /**
   * Số ngày giữa từ lúc tạo khách đến lần liên hệ đầu, đến lúc chốt thành công; null khi chưa có. Sự kiện ghi trước
   * lúc tạo khách (dữ liệu nhập lại) tính là 0 ngày.
   */
  medianDaysToContact: number | null;
  medianDaysToWin: number | null;
  /** Theo nguồn khách (đủ mọi nguồn, chưa ghi nguồn ở cuối) và theo người phụ trách (nhiều lead trước). */
  bySource: ConversionGroup[];
  byAgent: ConversionGroup[];
}

interface CohortRow {
  source: string | null;
  agent_id: string | null;
  agent_name: string | null;
  leads: number;
  contacted: number;
  viewed: number;
  negotiated: number;
  won: number;
  lost: number;
}

interface TimingRow {
  days_to_contact: string | null;
  days_to_win: string | null;
}

function percent(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 1000) / 10;
}

function days(value: string | null): number | null {
  return value === null ? null : Math.round(Number(value) * 10) / 10;
}

function sum(rows: CohortRow[], field: keyof CohortRow): number {
  return rows.reduce((total, row) => total + Number(row[field] ?? 0), 0);
}

function group(key: string | null, name: string | null, rows: CohortRow[]): ConversionGroup {
  const leads = sum(rows, 'leads');
  const won = sum(rows, 'won');
  return {
    key,
    name,
    leads,
    contacted: sum(rows, 'contacted'),
    won,
    conversionRate: percent(won, leads),
  };
}

/**
 * Phân tích chuyển đổi (TASK-153, MASTER_PLAN mục 15 "Conversion rate"): nhóm khách (lead) tạo trong kỳ, trong
 * phạm vi `report.view` (như dashboard), đã đi tới đâu tính đến hiện tại: liên hệ, đi xem nhà, đàm phán, chốt.
 * Một bước tính khách đã tới bước đó hoặc xa hơn, nên phễu luôn giảm dần.
 */
@Injectable()
export class ConversionAnalyticsService {
  constructor(private readonly reports: ReportsService) {}

  async conversion(
    actor: Actor,
    query: DashboardQueryDto,
    scope: PermissionScope,
  ): Promise<ConversionAnalytics> {
    assertTenant(actor.tenantId);
    const period = reportPeriod(query);
    const contactAt = `LEAST(
        (SELECT min(a.created_at) FROM customer_activities a
          WHERE a.tenant_id = c.tenant_id AND a.customer_id = c.id AND a.type IN (:...contactTypes)),
        (SELECT min(ap.created_at) FROM appointments ap
          WHERE ap.tenant_id = c.tenant_id AND ap.customer_id = c.id AND ap.deleted_at IS NULL),
        (SELECT min(d.created_at) FROM deals d
          WHERE d.tenant_id = c.tenant_id AND d.customer_id = c.id AND d.deleted_at IS NULL))`;
    const hasDeal = `EXISTS (SELECT 1 FROM deals d
          WHERE d.tenant_id = c.tenant_id AND d.customer_id = c.id AND d.deleted_at IS NULL)`;
    const wonAt = `(SELECT min(d.closed_at) FROM deals d
          WHERE d.tenant_id = c.tenant_id AND d.customer_id = c.id AND d.deleted_at IS NULL AND d.stage = 'WON')`;
    const isWon = `(${wonAt} IS NOT NULL OR c.status = 'WON')`;
    const isNegotiated = `(${hasDeal} OR c.status IN ('NEGOTIATING', 'DEPOSIT') OR ${isWon})`;
    const isViewed = `(EXISTS (SELECT 1 FROM appointments ap
          WHERE ap.tenant_id = c.tenant_id AND ap.customer_id = c.id AND ap.deleted_at IS NULL
            AND ap.status = 'COMPLETED') OR c.status = 'VIEWING' OR ${isNegotiated})`;
    const isContacted = `(${contactAt} IS NOT NULL OR c.status <> 'NEW' OR ${isViewed})`;
    const cohort = () =>
      this.reports
        .scoped(actor, scope, 'customers', 'c')
        .andWhere('c.created_at >= :from AND c.created_at < :to')
        .setParameters({ ...period, contactTypes: CONTACT_ACTIVITY_TYPES });

    const [rows, timing] = await Promise.all([
      cohort()
        .leftJoin('users', 'u', 'u.tenant_id = c.tenant_id AND u.id = c.agent_id')
        .select('c.source', 'source')
        .addSelect('c.agent_id', 'agent_id')
        .addSelect('u.full_name', 'agent_name')
        .addSelect('count(*)::int', 'leads')
        .addSelect(`(count(*) FILTER (WHERE ${isContacted}))::int`, 'contacted')
        .addSelect(`(count(*) FILTER (WHERE ${isViewed}))::int`, 'viewed')
        .addSelect(`(count(*) FILTER (WHERE ${isNegotiated}))::int`, 'negotiated')
        .addSelect(`(count(*) FILTER (WHERE ${isWon}))::int`, 'won')
        .addSelect(`(count(*) FILTER (WHERE c.status = 'LOST' AND NOT ${isWon}))::int`, 'lost')
        .groupBy('c.source')
        .addGroupBy('c.agent_id')
        .addGroupBy('u.full_name')
        .getRawMany<CohortRow>(),
      cohort()
        .select(
          `(percentile_cont(0.5) WITHIN GROUP (ORDER BY GREATEST(extract(epoch FROM ${contactAt} - c.created_at), 0) / 86400)
              FILTER (WHERE ${contactAt} IS NOT NULL))::text`,
          'days_to_contact',
        )
        .addSelect(
          `(percentile_cont(0.5) WITHIN GROUP (ORDER BY GREATEST(extract(epoch FROM ${wonAt} - c.created_at), 0) / 86400)
              FILTER (WHERE ${wonAt} IS NOT NULL))::text`,
          'days_to_win',
        )
        .getRawOne<TimingRow>(),
    ]);

    const counts: Record<ConversionStep, number> = {
      LEAD: sum(rows, 'leads'),
      CONTACTED: sum(rows, 'contacted'),
      VIEWED: sum(rows, 'viewed'),
      NEGOTIATED: sum(rows, 'negotiated'),
      WON: sum(rows, 'won'),
    };
    const sources = [...CUSTOMER_SOURCES, null];
    const agents = new Map<string | null, { name: string | null; rows: CohortRow[] }>();
    for (const row of rows) {
      const entry = agents.get(row.agent_id) ?? { name: row.agent_name, rows: [] };
      entry.rows.push(row);
      agents.set(row.agent_id, entry);
    }

    return {
      period,
      scope,
      funnel: CONVERSION_STEPS.map((step, index) => {
        const previous = index === 0 ? undefined : CONVERSION_STEPS[index - 1];
        return {
          step,
          count: counts[step],
          rateFromLead: percent(counts[step], counts.LEAD),
          rateFromPrevious: previous === undefined ? null : percent(counts[step], counts[previous]),
        };
      }),
      lost: sum(rows, 'lost'),
      medianDaysToContact: days(timing?.days_to_contact ?? null),
      medianDaysToWin: days(timing?.days_to_win ?? null),
      bySource: sources.map((source) =>
        group(
          source,
          null,
          rows.filter((row) => row.source === source),
        ),
      ),
      byAgent: [...agents.entries()]
        .map(([agentId, entry]) => group(agentId, entry.name, entry.rows))
        .sort(
          (a, b) =>
            b.leads - a.leads || b.won - a.won || (a.name ?? '').localeCompare(b.name ?? '', 'vi'),
        ),
    };
  }
}
