import { type BackendDeps, type BackendResult, callBackend } from './backend.ts';

/** Nhóm doanh số theo loại BĐS hoặc phường/xã. */
export interface SalesGroup {
  key: string;
  name: string | null;
  wonCount: number;
  revenue: number;
}

/** `GET /reports/sales` (TASK-152). */
export interface SalesAnalytics {
  period: { from: string; to: string };
  scope: string;
  summary: {
    wonCount: number;
    revenue: number;
    avgDealValue: number | null;
    lostCount: number;
    winRate: number | null;
    medianDaysToClose: number | null;
  };
  previous: { from: string; to: string; wonCount: number; revenue: number };
  pipeline: { stage: string; count: number; value: number }[];
  trend: { month: string; wonCount: number; revenue: number }[];
  byPropertyType: SalesGroup[];
  byWard: SalesGroup[];
}

/** Kỳ phân tích chọn nhanh (số tháng gần nhất), qua `?months=`. */
export const ANALYTICS_MONTHS = [3, 6, 12] as const;
export const DEFAULT_ANALYTICS_MONTHS = 6;

export function analyticsMonths(raw: string | string[] | undefined): number {
  const months = Number(typeof raw === 'string' ? raw : undefined);
  return (ANALYTICS_MONTHS as readonly number[]).includes(months)
    ? months
    : DEFAULT_ANALYTICS_MONTHS;
}

/** Kỳ `[now - months tháng, now)`. */
export function analyticsPeriod(months: number, now: Date = new Date()): { from: Date; to: Date } {
  const from = new Date(now);
  from.setUTCMonth(from.getUTCMonth() - months);
  return { from, to: now };
}

export function fetchSales(
  accessToken: string,
  months: number,
  now: Date = new Date(),
  deps?: BackendDeps,
): Promise<BackendResult<SalesAnalytics>> {
  const { from, to } = analyticsPeriod(months, now);
  const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  return callBackend<SalesAnalytics>(`/reports/sales?${query.toString()}`, { accessToken }, deps);
}

/** % thay đổi so với kỳ trước, 1 chữ số thập phân; kỳ trước bằng 0 thì null. */
export function changePercent(current: number, previous: number): number | null {
  return previous === 0 ? null : Math.round(((current - previous) / previous) * 1000) / 10;
}
