import { Injectable } from '@nestjs/common';

import type { PermissionScope } from '../auth/permission.service.js';
import { assertTenant } from '../database/tenant.repository.js';
import { DISPLAY_TIME_ZONE } from '../notifications/notification-values.js';
import type { Actor } from '../properties/properties.service.js';
import type { DashboardQueryDto } from './dto/dashboard-query.dto.js';
import { ReportsService, reportPeriod } from './reports.service.js';

/**
 * Điểm xếp hạng (MASTER_PLAN mục 17, mặc định đề xuất chờ Huy Lê xác nhận): mỗi tin đăng mới, mỗi khách được chăm
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
    const rows = await this.reports
      .scoped(actor, scope, 'users', 'u', { agent: 'u.id', creator: 'u.id' })
      .select('u.id', 'id')
      .addSelect('u.full_name', 'full_name')
      .addSelect('u.avatar_url', 'avatar_url')
      .addSelect(
        `(SELECT count(*) FROM properties p
           WHERE p.tenant_id = u.tenant_id AND p.agent_id = u.id AND p.deleted_at IS NULL
             AND ${inPeriod('p.created_at')})::int`,
        'listings',
      )
      .addSelect(
        `(SELECT count(DISTINCT (a.customer_id, (a.created_at AT TIME ZONE '${DISPLAY_TIME_ZONE}')::date))
            FROM customer_activities a
            JOIN customers c ON c.tenant_id = a.tenant_id AND c.id = a.customer_id AND c.deleted_at IS NULL
           WHERE a.tenant_id = u.tenant_id AND a.user_id = u.id AND a.type IN (:...careTypes)
             AND ${inPeriod('a.created_at')})::int`,
        'care_days',
      )
      .addSelect(
        `(SELECT count(*) FROM appointments ap
           WHERE ap.tenant_id = u.tenant_id AND ap.agent_id = u.id AND ap.deleted_at IS NULL
             AND ap.status = 'COMPLETED' AND ${inPeriod('ap.scheduled_at')})::int`,
        'viewings',
      )
      .addSelect(
        `(SELECT count(*) FROM deals d
           WHERE d.tenant_id = u.tenant_id AND d.agent_id = u.id AND d.deleted_at IS NULL
             AND d.stage = 'WON' AND ${inPeriod('d.closed_at')})::int`,
        'deals_won',
      )
      .addSelect(
        `(SELECT coalesce(sum(d.deal_price), 0) FROM deals d
           WHERE d.tenant_id = u.tenant_id AND d.agent_id = u.id AND d.deleted_at IS NULL
             AND d.stage = 'WON' AND ${inPeriod('d.closed_at')})::text`,
        'revenue',
      )
      .andWhere(`u.status = 'ACTIVE'`)
      .setParameters({ ...period, careTypes: CARE_ACTIVITY_TYPES })
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
