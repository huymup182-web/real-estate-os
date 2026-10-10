import { Injectable } from '@nestjs/common';

import type { PermissionScope } from '../auth/permission.service.js';
import { assertTenant } from '../database/tenant.repository.js';
import { DISPLAY_TIME_ZONE } from '../notifications/notification-values.js';
import type { Actor } from '../properties/properties.service.js';
import type { DashboardQueryDto } from './dto/dashboard-query.dto.js';
import { ReportsService, reportPeriod } from './reports.service.js';

/**
 * Điểm xếp hạng (MASTER_PLAN mục 17, Huy Lê chọn ngày 2026-10-10): mỗi tin đăng mới, mỗi khách được chăm
 * sóc trong một ngày, mỗi buổi dẫn khách hoàn thành, mỗi giao dịch chốt. "Hỗ trợ đồng đội" chưa có dữ liệu nên chưa
 * tính.
 */
export const LEADERBOARD_POINTS = { listing: 5, care: 1, viewing: 3, dealWon: 20 } as const;

/** Hoạt động chăm sóc khách tính điểm; đổi trạng thái, giao khách là thao tác hệ thống nên không tính. */
export const CARE_ACTIVITY_TYPES = [
  'CALL',
  'MESSAGE',
  'PROPERTY_SENT',
  'VIEWING',
  'NEGOTIATION',
  'DEPOSIT',
  'NOTE',
] as const;

export interface LeaderboardAgent {
  /** Hạng theo điểm; bằng điểm thì cùng hạng (1, 1, 3). */
  rank: number;
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  points: number;
  /** BĐS mới mình phụ trách, tạo trong kỳ. */
  listings: number;
  /** Số lượt (khách, ngày) có hoạt động chăm sóc do mình ghi trong kỳ: một khách một ngày tính một lần. */
  careDays: number;
  /** Buổi dẫn khách hoàn thành, hẹn trong kỳ. */
  viewings: number;
  /** Giao dịch chốt thành công (WON) trong kỳ và tổng giá trị (deal_price). */
  dealsWon: number;
  revenue: number;
}

export interface Leaderboard {
  period: { from: Date; to: Date };
  scope: PermissionScope;
  points: typeof LEADERBOARD_POINTS;
  /** Điểm cao trước; bằng điểm thì doanh số, số giao dịch cao trước, rồi theo tên. */
  agents: LeaderboardAgent[];
}

interface AgentRow {
  id: string;
  full_name: string;
  avatar_url: string | null;
  listings: number;
  care_days: number;
  viewings: number;
  deals_won: number;
  revenue: string;
}

export function pointsOf(
  agent: Pick<LeaderboardAgent, 'listings' | 'careDays' | 'viewings' | 'dealsWon'>,
): number {
  return (
    agent.listings * LEADERBOARD_POINTS.listing +
    agent.careDays * LEADERBOARD_POINTS.care +
    agent.viewings * LEADERBOARD_POINTS.viewing +
    agent.dealsWon * LEADERBOARD_POINTS.dealWon
  );
}

/** Sắp xếp và gán hạng (bằng điểm cùng hạng). */
export function rankAgents(agents: Omit<LeaderboardAgent, 'rank'>[]): LeaderboardAgent[] {
  const sorted = [...agents].sort(
    (a, b) =>
      b.points - a.points ||
      b.revenue - a.revenue ||
      b.dealsWon - a.dealsWon ||
      a.fullName.localeCompare(b.fullName, 'vi'),
  );
  return sorted.map((agent, index) => {
    const first = sorted.findIndex((other) => other.points === agent.points);
    return { ...agent, rank: (first === -1 ? index : first) + 1 };
  });
}

/**
 * Bảng xếp hạng môi giới (TASK-151, MASTER_PLAN mục 17): người dùng đang hoạt động trong phạm vi `report.view`,
 * kèm số tin đăng, chăm sóc khách, dẫn khách, giao dịch chốt, doanh số trong kỳ và tổng điểm. Chỉ đọc, không ghi
 * gì vào dữ liệu giao dịch.
 */
@Injectable()
export class LeaderboardService {
  constructor(private readonly reports: ReportsService) {}

  async leaderboard(
    actor: Actor,
    query: DashboardQueryDto,
    scope: PermissionScope,
  ): Promise<Leaderboard> {
    assertTenant(actor.tenantId);
    const period = reportPeriod(query);
    const inPeriod = (column: string): string => `${column} >= :from AND ${column} < :to`;
    // Mỗi chỉ số gom theo người một lần rồi nối vào (TASK-154), thay vì đếm lại cho từng người.
    const rows = await this.reports
      .scoped(actor, scope, 'users', 'u', { agent: 'u.id', creator: 'u.id' })
      .leftJoin(
        (listings) =>
          listings
            .select('p.agent_id', 'user_id')
            .addSelect('count(*)', 'n')
            .from('properties', 'p')
            .where('p.tenant_id = :leaderboardTenant AND p.deleted_at IS NULL')
            .andWhere(inPeriod('p.created_at'))
            .groupBy('p.agent_id'),
        'l',
        'l.user_id = u.id',
      )
      .leftJoin(
        (care) =>
          care
            .select('cd.user_id', 'user_id')
            .addSelect('count(*)', 'n')
            .from(
              (days) =>
                days
                  .select('a.user_id', 'user_id')
                  .addSelect('a.customer_id', 'customer_id')
                  .addSelect(`(a.created_at AT TIME ZONE '${DISPLAY_TIME_ZONE}')::date`, 'day')
                  .distinct()
                  .from('customer_activities', 'a')
                  .innerJoin(
                    'customers',
                    'c',
                    'c.tenant_id = a.tenant_id AND c.id = a.customer_id AND c.deleted_at IS NULL',
                  )
                  .where('a.tenant_id = :leaderboardTenant AND a.type IN (:...careTypes)')
                  .andWhere(inPeriod('a.created_at')),
              'cd',
            )
            .groupBy('cd.user_id'),
        'cd',
        'cd.user_id = u.id',
      )
      .leftJoin(
        (viewings) =>
          viewings
            .select('ap.agent_id', 'user_id')
            .addSelect('count(*)', 'n')
            .from('appointments', 'ap')
            .where('ap.tenant_id = :leaderboardTenant AND ap.deleted_at IS NULL')
            .andWhere(`ap.status = 'COMPLETED'`)
            .andWhere(inPeriod('ap.scheduled_at'))
            .groupBy('ap.agent_id'),
        'v',
        'v.user_id = u.id',
      )
      .leftJoin(
        (won) =>
          won
            .select('d.agent_id', 'user_id')
            .addSelect('count(*)', 'n')
            .addSelect('sum(d.deal_price)', 'revenue')
            .from('deals', 'd')
            .where('d.tenant_id = :leaderboardTenant AND d.deleted_at IS NULL')
            .andWhere(`d.stage = 'WON'`)
            .andWhere(inPeriod('d.closed_at'))
            .groupBy('d.agent_id'),
        'w',
        'w.user_id = u.id',
      )
      .select('u.id', 'id')
      .addSelect('u.full_name', 'full_name')
      .addSelect('u.avatar_url', 'avatar_url')
      .addSelect('coalesce(l.n, 0)::int', 'listings')
      .addSelect('coalesce(cd.n, 0)::int', 'care_days')
      .addSelect('coalesce(v.n, 0)::int', 'viewings')
      .addSelect('coalesce(w.n, 0)::int', 'deals_won')
      .addSelect('coalesce(w.revenue, 0)::text', 'revenue')
      .andWhere(`u.status = 'ACTIVE'`)
      .setParameters({
        ...period,
        careTypes: CARE_ACTIVITY_TYPES,
        leaderboardTenant: actor.tenantId,
      })
      .getRawMany<AgentRow>();

    return {
      period,
      scope,
      points: LEADERBOARD_POINTS,
      agents: rankAgents(
        rows.map((row) => {
          const agent = {
            userId: row.id,
            fullName: row.full_name,
            avatarUrl: row.avatar_url,
            listings: row.listings,
            careDays: row.care_days,
            viewings: row.viewings,
            dealsWon: row.deals_won,
            revenue: Number(row.revenue),
          };
          return { ...agent, points: pointsOf(agent) };
        }),
      ),
    };
  }
}
