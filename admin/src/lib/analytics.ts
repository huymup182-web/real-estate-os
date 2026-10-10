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

/** Nhóm chuyển đổi theo nguồn khách hoặc người phụ trách (`key` null = chưa ghi nguồn / chưa giao). */
export interface ConversionGroup {
  key: string | null;
  name: string | null;
  leads: number;
  contacted: number;
  won: number;
  conversionRate: number | null;
}

/** `GET /reports/conversion` (TASK-153). */
export interface ConversionAnalytics {
  period: { from: string; to: string };
  scope: string;
  funnel: {
    step: string;
    count: number;
    rateFromLead: number | null;
    rateFromPrevious: number | null;
  }[];
  lost: number;
  medianDaysToContact: number | null;
  medianDaysToWin: number | null;
  bySource: ConversionGroup[];
  byAgent: ConversionGroup[];
}

export const CONVERSION_STEP_LABELS: Record<string, string> = {
  LEAD: 'Lead mới',
  CONTACTED: 'Đã liên hệ',
  VIEWED: 'Đã đi xem',
  NEGOTIATED: 'Đàm phán',
  WON: 'Chốt thành công',
};

/** Hai tab của trang Phân tích, qua `?tab=`. */
export const ANALYTICS_TABS = { sales: 'Doanh số', conversion: 'Chuyển đổi' } as const;
export type AnalyticsTab = keyof typeof ANALYTICS_TABS;

export function analyticsTab(raw: string | string[] | undefined): AnalyticsTab {
  return raw === 'conversion' ? 'conversion' : 'sales';
}

/** Link trang Phân tích, bỏ tham số mặc định. */
export function analyticsHref(tab: AnalyticsTab, months: number): string {
  const query = new URLSearchParams();
  if (tab !== 'sales') {
    query.set('tab', tab);
  }
  if (months !== DEFAULT_ANALYTICS_MONTHS) {
    query.set('months', String(months));
  }
  const text = query.toString();
  return text ? `/analytics?${text}` : '/analytics';
}

export function fetchConversion(
  accessToken: string,
  months: number,
  now: Date = new Date(),
  deps?: BackendDeps,
): Promise<BackendResult<ConversionAnalytics>> {
  const { from, to } = analyticsPeriod(months, now);
  const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  return callBackend<ConversionAnalytics>(
    `/reports/conversion?${query.toString()}`,
    { accessToken },
    deps,
  );
}
