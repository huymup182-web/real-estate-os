import { type BackendDeps, type BackendResult, callBackend } from './backend.ts';

/** Một môi giới trên bảng xếp hạng (`GET /reports/leaderboard`, TASK-151). */
export interface LeaderboardAgent {
  rank: number;
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  points: number;
  listings: number;
  careDays: number;
  viewings: number;
  dealsWon: number;
  revenue: number;
}

export interface Leaderboard {
  period: { from: string; to: string };
  scope: string;
  points: { listing: number; care: number; viewing: number; dealWon: number };
  agents: LeaderboardAgent[];
}

/** Các bảng Top (MASTER_PLAN mục 17), chọn qua `?by=`. */
export const LEADERBOARD_SORTS = {
  points: 'Top môi giới',
  revenue: 'Top doanh số',
  listings: 'Top tin đăng',
  deals: 'Top giao dịch',
} as const;
export type LeaderboardSort = keyof typeof LEADERBOARD_SORTS;
export const DEFAULT_SORT: LeaderboardSort = 'points';

const METRIC: Record<LeaderboardSort, (agent: LeaderboardAgent) => number> = {
  points: (agent) => agent.points,
  revenue: (agent) => agent.revenue,
  listings: (agent) => agent.listings,
  deals: (agent) => agent.dealsWon,
};

/** Bảng từ `?by=`; giá trị lạ thì là Top môi giới. */
export function leaderboardSort(raw: string | string[] | undefined): LeaderboardSort {
  return typeof raw === 'string' && Object.hasOwn(LEADERBOARD_SORTS, raw)
    ? (raw as LeaderboardSort)
    : DEFAULT_SORT;
}

/** Xếp lại theo chỉ số của bảng [sort], cao trước; bằng nhau thì cùng hạng, xếp theo điểm rồi tên. */
export function rankBy(agents: LeaderboardAgent[], sort: LeaderboardSort): LeaderboardAgent[] {
  const metric = METRIC[sort];
  const sorted = [...agents].sort(
    (a, b) =>
      metric(b) - metric(a) || b.points - a.points || a.fullName.localeCompare(b.fullName, 'vi'),
  );
  return sorted.map((agent) => ({
    ...agent,
    rank: sorted.findIndex((other) => metric(other) === metric(agent)) + 1,
  }));
}

export function leaderboardHref(sort: LeaderboardSort, days: number): string {
  const query = new URLSearchParams();
  if (sort !== DEFAULT_SORT) {
    query.set('by', sort);
  }
  if (days !== 30) {
    query.set('days', String(days));
  }
  const text = query.toString();
  return text ? `/leaderboard?${text}` : '/leaderboard';
}

const DAY_MS = 24 * 3600 * 1000;

export function fetchLeaderboard(
  accessToken: string,
  days: number,
  now: Date = new Date(),
  deps?: BackendDeps,
): Promise<BackendResult<Leaderboard>> {
  const query = new URLSearchParams({
    from: new Date(now.getTime() - days * DAY_MS).toISOString(),
    to: now.toISOString(),
  });
  return callBackend<Leaderboard>(
    `/reports/leaderboard?${query.toString()}`,
    { accessToken },
    deps,
  );
}
