import { type BackendDeps, type BackendResult, callBackend } from './backend.ts';
import { PROPERTY_TYPE_LABELS, type PropertyType } from './properties.ts';

type SearchParams = Record<string, string | string[] | undefined>;

/** `GET /reports/market/prices` (TASK-145). Các số giá là null khi nhóm có dưới `minSample` tin. */
export interface PriceStats {
  count: number;
  avgPrice: number | null;
  medianPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  avgArea: number | null;
}

export interface MarketPrices {
  period: { from: string; to: string; months: number };
  minSample: number;
  overall: PriceStats;
  groups: (PriceStats & { key: string; name: string | null })[];
}

/** `GET /reports/market/price-per-m2` (TASK-146). */
export interface PerM2Stats {
  count: number;
  avgPricePerM2: number | null;
  medianPricePerM2: number | null;
  minPricePerM2: number | null;
  maxPricePerM2: number | null;
}

export interface MarketPricePerM2 {
  overall: PerM2Stats;
  groups: (PerM2Stats & { key: string; name: string | null })[];
  trend: (PerM2Stats & { month: string })[];
}

/** `GET /reports/market/liquidity` (TASK-147). */
export interface LiquidityStats {
  supply: number;
  sold: number;
  sellThroughRate: number | null;
  level: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  medianDaysToSell: number | null;
  medianDaysListed: number | null;
  viewsPerListing: number | null;
  viewingsPerListing: number | null;
}

export interface MarketLiquidity {
  thresholds: { high: number; medium: number };
  overall: LiquidityStats;
  groups: (LiquidityStats & { key: string; name: string | null })[];
}

export const MARKET_GROUP_LABELS = {
  ward: 'Theo phường/xã',
  propertyType: 'Theo loại BĐS',
} as const;
export type MarketGroupBy = keyof typeof MARKET_GROUP_LABELS;

/** Các kỳ chọn nhanh (số tháng gần nhất). */
export const MONTH_OPTIONS = [3, 6, 12, 24] as const;
export const DEFAULT_MONTHS = 12;

export const LIQUIDITY_LABELS: Record<string, string> = {
  HIGH: 'Cao',
  MEDIUM: 'Trung bình',
  LOW: 'Thấp',
};

export interface MarketFilters {
  provinceId: string;
  propertyType: PropertyType | '';
  groupBy: MarketGroupBy;
  months: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function single(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Bộ lọc từ query của trang; giá trị sai thì dùng mặc định thay vì để backend báo lỗi. */
export function marketFilters(params: SearchParams): MarketFilters {
  const provinceId = single(params['provinceId']);
  const propertyType = single(params['propertyType']);
  const groupBy = single(params['groupBy']);
  const months = Number(single(params['months']));
  return {
    provinceId: UUID.test(provinceId) ? provinceId : '',
    propertyType: propertyType in PROPERTY_TYPE_LABELS ? (propertyType as PropertyType) : '',
    groupBy: groupBy === 'propertyType' ? 'propertyType' : 'ward',
    months: (MONTH_OPTIONS as readonly number[]).includes(months) ? months : DEFAULT_MONTHS,
  };
}

/** Query string cho backend và cho link trên trang (bỏ giá trị mặc định). */
export function marketQuery(filters: MarketFilters): string {
  const query = new URLSearchParams();
  if (filters.provinceId) {
    query.set('provinceId', filters.provinceId);
  }
  if (filters.propertyType) {
    query.set('propertyType', filters.propertyType);
  }
  if (filters.groupBy !== 'ward') {
    query.set('groupBy', filters.groupBy);
  }
  if (filters.months !== DEFAULT_MONTHS) {
    query.set('months', String(filters.months));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

export interface MarketData {
  prices: MarketPrices;
  perM2: MarketPricePerM2;
  liquidity: MarketLiquidity;
}

/** Gọi ba API thị trường cùng lúc; một API lỗi thì trả lỗi đó. */
export async function fetchMarket(
  token: string,
  filters: MarketFilters,
  deps?: BackendDeps,
): Promise<BackendResult<MarketData>> {
  const query = marketQuery(filters);
  const [prices, perM2, liquidity] = await Promise.all([
    callBackend<MarketPrices>(`/reports/market/prices${query}`, { accessToken: token }, deps),
    callBackend<MarketPricePerM2>(
      `/reports/market/price-per-m2${query}`,
      { accessToken: token },
      deps,
    ),
    callBackend<MarketLiquidity>(`/reports/market/liquidity${query}`, { accessToken: token }, deps),
  ]);
  if (!prices.ok) {
    return prices;
  }
  if (!perM2.ok) {
    return perM2;
  }
  if (!liquidity.ok) {
    return liquidity;
  }
  return {
    ok: true,
    status: 200,
    data: { prices: prices.data, perM2: perM2.data, liquidity: liquidity.data },
  };
}

/** Một dòng bảng xếp hạng khu vực: gộp giá, giá/m², thanh khoản theo cùng nhóm. */
export interface AreaRow {
  key: string;
  label: string;
  prices: PriceStats | null;
  perM2: PerM2Stats | null;
  liquidity: LiquidityStats | null;
}

/**
 * Gộp các nhóm của ba API theo `key`. Thứ tự: nhóm có nhiều tin tính giá trước, rồi các nhóm chỉ có cung/đã bán
 * (tin đăng ngoài kỳ) theo số tin.
 */
export function areaRows(data: MarketData, groupBy: MarketGroupBy): AreaRow[] {
  const rows = new Map<string, AreaRow>();
  const row = (key: string, name: string | null): AreaRow => {
    let found = rows.get(key);
    if (!found) {
      const label =
        groupBy === 'propertyType'
          ? (PROPERTY_TYPE_LABELS[key as PropertyType] ?? key)
          : (name ?? key);
      found = { key, label, prices: null, perM2: null, liquidity: null };
      rows.set(key, found);
    }
    return found;
  };
  for (const group of data.prices.groups) {
    row(group.key, group.name).prices = group;
  }
  for (const group of data.perM2.groups) {
    row(group.key, group.name).perM2 = group;
  }
  for (const group of data.liquidity.groups) {
    row(group.key, group.name).liquidity = group;
  }
  const listings = (item: AreaRow) => (item.liquidity?.supply ?? 0) + (item.liquidity?.sold ?? 0);
  return [...rows.values()].sort(
    (a, b) =>
      (b.prices?.count ?? 0) - (a.prices?.count ?? 0) ||
      listings(b) - listings(a) ||
      a.label.localeCompare(b.label, 'vi'),
  );
}

/**
 * Thay đổi giá/m² giữa (%) từ tháng đầu đến tháng cuối có số liệu trong kỳ, 1 chữ số thập phân; null khi có
 * dưới hai tháng có số liệu.
 */
export function trendChange(trend: MarketPricePerM2['trend']): number | null {
  const values = trend
    .map((month) => month.medianPricePerM2)
    .filter((value): value is number => value !== null && value > 0);
  const first = values[0];
  const last = values.at(-1);
  if (values.length < 2 || first === undefined || last === undefined) {
    return null;
  }
  return Math.round(((last - first) / first) * 1000) / 10;
}

const decimalFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });

/** "+6,2%", "-3%", "0%". */
export function formatChange(value: number): string {
  return `${value > 0 ? '+' : ''}${decimalFormat.format(value)}%`;
}

export function formatPercent(value: number): string {
  return `${decimalFormat.format(value)}%`;
}

export function formatDecimal(value: number): string {
  return decimalFormat.format(value);
}

/** Tháng `YYYY-MM` thành "T10/2026". */
export function formatMonth(month: string): string {
  const [year, value] = month.split('-');
  return `T${Number(value)}/${year}`;
}
