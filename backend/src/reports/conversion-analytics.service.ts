import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

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
  constructor(
    private readonly dataSource: DataSource,
    private readonly reports: ReportsService,
  ) {}

  async conversion(
    actor: Actor,
    query: DashboardQueryDto,
    scope: PermissionScope,
  ): Promise<ConversionAnalytics> {
    assertTenant(actor.tenantId);
    const period = reportPeriod(query);
    // Mỗi khách tính các mốc một lần trong bảng con `f` (TASK-154), rồi mới đếm theo bước. Hoạt động, lịch hẹn,
    // giao dịch gom theo khách một lần (chỉ khách tạo trong kỳ) rồi nối vào, thay vì tìm lại cho từng khách.
    const cohortIds = `SELECT k.id FROM customers k
      WHERE k.tenant_id = :conversionTenant AND k.created_at >= :from AND k.created_at < :to`;
    const facts = this.reports
      .scoped(actor, scope, 'customers', 'c')
      .andWhere('c.created_at >= :from AND c.created_at < :to')
      .leftJoin(
        (activities) =>
          activities
            .select('a.customer_id', 'customer_id')
            .addSelect('min(a.created_at)', 'first_at')
            .from('customer_activities', 'a')
            .where('a.tenant_id = :conversionTenant AND a.type IN (:...contactTypes)')
            .andWhere(`a.customer_id IN (${cohortIds})`)
            .groupBy('a.customer_id'),
        'fa',
        'fa.customer_id = c.id',
      )
      .leftJoin(
        (appointments) =>
          appointments
            .select('ap.customer_id', 'customer_id')
            .addSelect('min(ap.created_at)', 'first_at')
            .addSelect(`bool_or(ap.status = 'COMPLETED')`, 'completed')
            .from('appointments', 'ap')
            .where('ap.tenant_id = :conversionTenant AND ap.deleted_at IS NULL')
            .andWhere(`ap.customer_id IN (${cohortIds})`)
            .groupBy('ap.customer_id'),
        'fap',
        'fap.customer_id = c.id',
      )
      .leftJoin(
        (deals) =>
          deals
            .select('d.customer_id', 'customer_id')
            .addSelect('min(d.created_at)', 'first_at')
            .addSelect(`min(d.closed_at) FILTER (WHERE d.stage = 'WON')`, 'won_at')
            .from('deals', 'd')
            .where('d.tenant_id = :conversionTenant AND d.deleted_at IS NULL')
            .andWhere(`d.customer_id IN (${cohortIds})`)
            .groupBy('d.customer_id'),
        'fd',
        'fd.customer_id = c.id',
      )
      .select('c.source', 'source')
      .addSelect('c.agent_id', 'agent_id')
      .addSelect('c.status', 'status')
      .addSelect('c.created_at', 'created_at')
      .addSelect('LEAST(fa.first_at, fap.first_at, fd.first_at)', 'contact_at')
      .addSelect('fd.won_at', 'won_at')
      .addSelect('fd.customer_id IS NOT NULL', 'has_deal')
      .addSelect('coalesce(fap.completed, false)', 'has_viewing')
      .setParameters({
        ...period,
        contactTypes: CONTACT_ACTIVITY_TYPES,
        conversionTenant: actor.tenantId,
      });
    const isWon = `(f.won_at IS NOT NULL OR f.status = 'WON')`;
    const isNegotiated = `(f.has_deal OR f.status IN ('NEGOTIATING', 'DEPOSIT') OR ${isWon})`;
    const isViewed = `(f.has_viewing OR f.status = 'VIEWING' OR ${isNegotiated})`;
    const isContacted = `(f.contact_at IS NOT NULL OR f.status <> 'NEW' OR ${isViewed})`;
    const medianDays = (column: string): string =>
      `percentile_cont(0.5) WITHIN GROUP (ORDER BY GREATEST(extract(epoch FROM ${column} - f.created_at), 0) / 86400)
         FILTER (WHERE ${column} IS NOT NULL)`;

    // Từng nhóm (nguồn × người phụ trách) và tổng chung (cho số ngày giữa) trong một truy vấn.
    const all = await this.dataSource
      .createQueryBuilder()
      .from(`(${facts.getQuery()})`, 'f')
      .setParameters(facts.getParameters())
      .leftJoin('users', 'u', 'u.tenant_id = :conversionTenant AND u.id = f.agent_id')
      .select('f.source', 'source')
      .addSelect('f.agent_id', 'agent_id')
      .addSelect('u.full_name', 'agent_name')
      .addSelect('GROUPING(f.source, f.agent_id, u.full_name) <> 0', 'overall')
      .addSelect('count(*)::int', 'leads')
      .addSelect(`(count(*) FILTER (WHERE ${isContacted}))::int`, 'contacted')
      .addSelect(`(count(*) FILTER (WHERE ${isViewed}))::int`, 'viewed')
      .addSelect(`(count(*) FILTER (WHERE ${isNegotiated}))::int`, 'negotiated')
      .addSelect(`(count(*) FILTER (WHERE ${isWon}))::int`, 'won')
      .addSelect(`(count(*) FILTER (WHERE f.status = 'LOST' AND NOT ${isWon}))::int`, 'lost')
      .addSelect(`(${medianDays('f.contact_at')})::text`, 'days_to_contact')
      .addSelect(`(${medianDays('f.won_at')})::text`, 'days_to_win')
      .groupBy('GROUPING SETS ((f.source, f.agent_id, u.full_name), ())')
      .getRawMany<CohortRow & TimingRow & { overall: boolean }>();
    const rows = all.filter((row) => !row.overall);
    const timing = all.find((row) => row.overall);

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
