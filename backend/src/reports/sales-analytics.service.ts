import { Injectable } from '@nestjs/common';

import type { PermissionScope } from '../auth/permission.service.js';
import { assertTenant } from '../database/tenant.repository.js';
import { DISPLAY_TIME_ZONE } from '../notifications/notification-values.js';
import type { Actor } from '../properties/properties.service.js';
import type { DashboardQueryDto } from './dto/dashboard-query.dto.js';
import { monthOf, monthsBetween } from './market-stats.service.js';
import { ReportsService, reportPeriod } from './reports.service.js';

/** Giao dịch đang mở (chưa chốt) tính vào pipeline. */
const OPEN_STAGES = ['NEGOTIATING', 'DEPOSIT', 'CONTRACT'] as const;

export interface SalesSummary {
  /** Giao dịch chốt thành công (WON) trong kỳ theo `closed_at`, tổng và trung bình `deal_price`. */
  wonCount: number;
  revenue: number;
  avgDealValue: number | null;
  /** Giao dịch thất bại (LOST) đóng trong kỳ. */
  lostCount: number;
  /** won / (won + lost), %, 1 chữ số thập phân; null khi kỳ không có giao dịch đóng. */
  winRate: number | null;
  /** Số ngày giữa từ lúc tạo đến lúc chốt các giao dịch WON; null khi không có. */
  medianDaysToClose: number | null;
}

export interface SalesGroup {
  key: string;
  /** Tên phường/xã; null khi chia theo loại BĐS. */
  name: string | null;
  wonCount: number;
  revenue: number;
}

export interface SalesAnalytics {
  period: { from: Date; to: Date };
  scope: PermissionScope;
  summary: SalesSummary;
  /** Kỳ trước cùng độ dài, để so sánh. */
  previous: { from: Date; to: Date; wonCount: number; revenue: number };
  /** Giao dịch đang mở hiện tại (đàm phán, đặt cọc, hợp đồng). */
  pipeline: { stage: (typeof OPEN_STAGES)[number]; count: number; value: number }[];
  /** Mọi tháng trong kỳ (giờ Việt Nam), cũ trước. */
  trend: { month: string; wonCount: number; revenue: number }[];
  /** Doanh số theo loại BĐS và 10 phường/xã nhiều doanh số nhất, cao trước. */
  byPropertyType: SalesGroup[];
  byWard: SalesGroup[];
}

const TOP_WARDS = 10;

interface SummaryRow {
  won_count: number;
  revenue: string;
  lost_count: number;
  median_days: string | null;
}

interface GroupRow {
  key: string;
  name: string | null;
  won_count: number;
  revenue: string;
}

function medianDays(value: string | null): number | null {
  return value === null ? null : Math.round(Number(value) * 10) / 10;
}

function toGroups(rows: GroupRow[]): SalesGroup[] {
  return rows.map((row) => ({
    key: row.key,
    name: row.name,
    wonCount: row.won_count,
    revenue: Number(row.revenue),
  }));
}

/**
 * Phân tích doanh số (TASK-152, MASTER_PLAN mục 15–16): doanh số, tỷ lệ thắng, thời gian chốt, pipeline, xu hướng
 * theo tháng, theo loại BĐS và khu vực. Chỉ tính giao dịch trong phạm vi `report.view` (như dashboard). Doanh số là
 * tổng `deal_price` của giao dịch WON (Huy Lê chọn 2026-10-09, TASK-102).
 */
@Injectable()
export class SalesAnalyticsService {
  constructor(private readonly reports: ReportsService) {}

  async sales(
    actor: Actor,
    query: DashboardQueryDto,
    scope: PermissionScope,
  ): Promise<SalesAnalytics> {
    assertTenant(actor.tenantId);
    const period = reportPeriod(query);
    const previous = {
      from: new Date(2 * period.from.getTime() - period.to.getTime()),
      to: period.from,
    };
    const deals = () => this.reports.scoped(actor, scope, 'deals', 'd');
    const won = (range: { from: Date; to: Date }) =>
      deals()
        .andWhere(`d.stage = 'WON' AND d.closed_at >= :from AND d.closed_at < :to`)
        .setParameters(range);
    const month = `to_char(d.closed_at AT TIME ZONE '${DISPLAY_TIME_ZONE}', 'YYYY-MM')`;

    const [summary, previousRow, pipelineRows, trendRows, typeRows, wardRows] = await Promise.all([
      deals()
        .select(`(count(*) FILTER (WHERE d.stage = 'WON'))::int`, 'won_count')
        .addSelect(
          `(coalesce(sum(d.deal_price) FILTER (WHERE d.stage = 'WON'), 0))::text`,
          'revenue',
        )
        .addSelect(`(count(*) FILTER (WHERE d.stage = 'LOST'))::int`, 'lost_count')
        .addSelect(
          `(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM d.closed_at - d.created_at) / 86400)
              FILTER (WHERE d.stage = 'WON'))::text`,
          'median_days',
        )
        .andWhere(`d.stage IN ('WON', 'LOST') AND d.closed_at >= :from AND d.closed_at < :to`)
        .setParameters(period)
        .getRawOne<SummaryRow>(),
      won(previous)
        .select('count(*)::int', 'won_count')
        .addSelect('(coalesce(sum(d.deal_price), 0))::text', 'revenue')
        .getRawOne<{ won_count: number; revenue: string }>(),
      deals()
        .select('d.stage', 'stage')
        .addSelect('count(*)::int', 'count')
        .addSelect('(coalesce(sum(d.deal_price), 0))::text', 'value')
        .andWhere('d.stage IN (:...openStages)', { openStages: OPEN_STAGES })
        .groupBy('d.stage')
        .getRawMany<{ stage: string; count: number; value: string }>(),
      won(period)
        .select(month, 'month')
        .addSelect('count(*)::int', 'won_count')
        .addSelect('(coalesce(sum(d.deal_price), 0))::text', 'revenue')
        .groupBy(month)
        .getRawMany<{ month: string; won_count: number; revenue: string }>(),
      won(period)
        .innerJoin('properties', 'p', 'p.tenant_id = d.tenant_id AND p.id = d.property_id')
        .select('p.property_type', 'key')
        .addSelect('NULL', 'name')
        .addSelect('count(*)::int', 'won_count')
        .addSelect('(coalesce(sum(d.deal_price), 0))::text', 'revenue')
        .groupBy('p.property_type')
        .orderBy('coalesce(sum(d.deal_price), 0)', 'DESC')
        .addOrderBy('count(*)', 'DESC')
        .getRawMany<GroupRow>(),
      won(period)
        .innerJoin('properties', 'p', 'p.tenant_id = d.tenant_id AND p.id = d.property_id')
        .innerJoin('wards', 'w', 'w.id = p.ward_id')
        .select('w.id::text', 'key')
        .addSelect('w.name', 'name')
        .addSelect('count(*)::int', 'won_count')
        .addSelect('(coalesce(sum(d.deal_price), 0))::text', 'revenue')
        .groupBy('w.id')
        .addGroupBy('w.name')
        .orderBy('coalesce(sum(d.deal_price), 0)', 'DESC')
        .addOrderBy('count(*)', 'DESC')
        .limit(TOP_WARDS)
        .getRawMany<GroupRow>(),
    ]);

    const wonCount = summary?.won_count ?? 0;
    const lostCount = summary?.lost_count ?? 0;
    const revenue = Number(summary?.revenue ?? 0);
    const closed = wonCount + lostCount;
    const months = new Map(trendRows.map((row) => [row.month, row]));
    const stages = new Map(pipelineRows.map((row) => [row.stage, row]));
    // `to` không gồm: tháng cuối là tháng của thời điểm ngay trước `to`.
    const lastMonth = monthOf(new Date(period.to.getTime() - 1));
    return {
      period,
      scope,
      summary: {
        wonCount,
        revenue,
        avgDealValue: wonCount === 0 ? null : Math.round(revenue / wonCount),
        lostCount,
        winRate: closed === 0 ? null : Math.round((wonCount / closed) * 1000) / 10,
        medianDaysToClose: medianDays(summary?.median_days ?? null),
      },
      previous: {
        ...previous,
        wonCount: previousRow?.won_count ?? 0,
        revenue: Number(previousRow?.revenue ?? 0),
      },
      pipeline: OPEN_STAGES.map((stage) => ({
        stage,
        count: stages.get(stage)?.count ?? 0,
        value: Number(stages.get(stage)?.value ?? 0),
      })),
      trend: monthsBetween(monthOf(period.from), lastMonth).map((key) => ({
        month: key,
        wonCount: months.get(key)?.won_count ?? 0,
        revenue: Number(months.get(key)?.revenue ?? 0),
      })),
      byPropertyType: toGroups(typeRows),
      byWard: toGroups(wardRows),
    };
  }
}
