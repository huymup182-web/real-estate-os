import { Injectable } from '@nestjs/common';
import { DataSource, type SelectQueryBuilder } from 'typeorm';

import { assertTenant } from '../database/tenant.repository.js';
import {
  type Actor,
  PropertiesService,
  type PropertyScopes,
} from '../properties/properties.service.js';
import { DISPLAY_TIME_ZONE } from '../notifications/notification-values.js';
import type { Property } from '../properties/property.entity.js';
import {
  MARKET_DEFAULT_MONTHS,
  type MarketGroupBy,
  type MarketPriceQueryDto,
} from './dto/market-price-query.dto.js';

/**
 * Tin đăng tính vào thống kê giá: đang bán, đang giao dịch, đã bán (Huy Lê chọn ngày 2026-10-10). Tin ẩn, hết hạn,
 * chờ xác minh không còn phản ánh giá thị trường.
 */
export const MARKET_STATUSES = ['AVAILABLE', 'PENDING', 'SOLD'] as const;

/** Nhóm có ít tin hơn chừng này chỉ trả số tin, không trả giá (tránh số liệu lệch, lộ giá một căn). */
export const MARKET_MIN_SAMPLE = 3;

/** Thống kê giá (đồng) và diện tích (m²). Các số là null khi nhóm có dưới MARKET_MIN_SAMPLE tin. */
export interface PriceStats {
  count: number;
  avgPrice: number | null;
  medianPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  avgArea: number | null;
}

export interface PriceStatsGroup extends PriceStats {
  /** Mã phường/xã (groupBy=ward) hoặc loại BĐS (groupBy=propertyType). */
  key: string;
  /** Tên phường/xã; null khi chia theo loại BĐS (client tự hiển thị nhãn loại). */
  name: string | null;
}

export interface MarketPriceStats {
  period: { from: Date; to: Date; months: number };
  groupBy: MarketGroupBy;
  statuses: readonly string[];
  minSample: number;
  overall: PriceStats;
  /** Nhiều tin trước. */
  groups: PriceStatsGroup[];
}

/** Thống kê giá/m² (đồng/m², làm tròn). Các số là null khi có dưới MARKET_MIN_SAMPLE tin. */
export interface PricePerM2Stats {
  count: number;
  avgPricePerM2: number | null;
  medianPricePerM2: number | null;
  minPricePerM2: number | null;
  maxPricePerM2: number | null;
}

export interface PricePerM2Group extends PricePerM2Stats {
  key: string;
  name: string | null;
}

/** Một tháng (giờ Việt Nam) theo ngày đăng tin. */
export interface PricePerM2Month extends PricePerM2Stats {
  /** `YYYY-MM`. */
  month: string;
}

export interface MarketPricePerM2 {
  period: { from: Date; to: Date; months: number };
  groupBy: MarketGroupBy;
  statuses: readonly string[];
  minSample: number;
  overall: PricePerM2Stats;
  /** Nhiều tin trước. */
  groups: PricePerM2Group[];
  /** Mọi tháng trong kỳ, cũ trước; tháng không có tin thì `count` 0. */
  trend: PricePerM2Month[];
}

interface PerM2Row {
  count: number;
  avg: string | null;
  median: string | null;
  min: string | null;
  max: string | null;
}

function toPerM2(row: PerM2Row | undefined): PricePerM2Stats {
  const count = row?.count ?? 0;
  const enough = row !== undefined && count >= MARKET_MIN_SAMPLE;
  return {
    count,
    avgPricePerM2: enough ? round(row.avg) : null,
    medianPricePerM2: enough ? round(row.median) : null,
    minPricePerM2: enough ? round(row.min) : null,
    maxPricePerM2: enough ? round(row.max) : null,
  };
}

const MONTH_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
});

/** Tháng `YYYY-MM` của [date] theo giờ Việt Nam (dùng chung cho phân tích doanh số TASK-152). */
export function monthOf(date: Date): string {
  const parts = MONTH_FORMAT.formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}`;
}

/** Các tháng từ [first] đến [last] (gồm), dạng `YYYY-MM`. */
export function monthsBetween(first: string, last: string): string[] {
  const result: string[] = [];
  let [year, month] = first.split('-').map(Number) as [number, number];
  for (let current = first; current <= last;) {
    result.push(current);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    current = `${year}-${String(month).padStart(2, '0')}`;
  }
  return result;
}

/** Mức thanh khoản theo tỷ lệ bán được trong kỳ. */
export type LiquidityLevel = 'HIGH' | 'MEDIUM' | 'LOW';

/** Tỷ lệ bán được (%) từ mức này trở lên là Cao / Trung bình; thấp hơn là Thấp. */
export const LIQUIDITY_HIGH_RATE = 30;
export const LIQUIDITY_MEDIUM_RATE = 10;

export interface LiquidityStats {
  /** Tin đang bán, đang giao dịch (cung hiện tại). */
  supply: number;
  /** Căn chuyển sang Đã bán trong kỳ. */
  sold: number;
  /** sold / (sold + supply), %, 1 chữ số thập phân; null khi tổng dưới MARKET_MIN_SAMPLE. */
  sellThroughRate: number | null;
  level: LiquidityLevel | null;
  /** Số ngày giữa từ ngày đăng đến ngày chuyển Đã bán; null khi bán dưới MARKET_MIN_SAMPLE căn. */
  medianDaysToSell: number | null;
  /** Số ngày giữa các tin đang bán đã đăng; null khi cung dưới MARKET_MIN_SAMPLE. */
  medianDaysListed: number | null;
  /** Lượt xem, lượt dẫn khách (trừ lịch huỷ) trong kỳ, chia cho số tin (cung + đã bán); null khi không có tin. */
  viewsPerListing: number | null;
  viewingsPerListing: number | null;
}

export interface LiquidityGroup extends LiquidityStats {
  key: string;
  name: string | null;
}

export interface MarketLiquidity {
  period: { from: Date; to: Date; months: number };
  groupBy: MarketGroupBy;
  minSample: number;
  thresholds: { high: number; medium: number };
  overall: LiquidityStats;
  /** Nhiều tin (cung + đã bán) trước. */
  groups: LiquidityGroup[];
}

interface LiquidityRow {
  supply: number;
  sold: number;
  days_to_sell: string | null;
  days_listed: string | null;
  views: number;
  viewings: number;
}

/** Mức thanh khoản theo tỷ lệ bán được (Huy Lê chọn ngày 2026-10-10). */
export function liquidityLevel(rate: number | null): LiquidityLevel | null {
  if (rate === null) {
    return null;
  }
  if (rate >= LIQUIDITY_HIGH_RATE) {
    return 'HIGH';
  }
  return rate >= LIQUIDITY_MEDIUM_RATE ? 'MEDIUM' : 'LOW';
}

function perListing(total: number, listings: number): number | null {
  return listings === 0 ? null : Math.round((total / listings) * 10) / 10;
}

function toLiquidity(row: LiquidityRow | undefined): LiquidityStats {
  const supply = row?.supply ?? 0;
  const sold = row?.sold ?? 0;
  const listings = supply + sold;
  const rate = listings < MARKET_MIN_SAMPLE ? null : Math.round((sold / listings) * 1000) / 10;
  return {
    supply,
    sold,
    sellThroughRate: rate,
    level: liquidityLevel(rate),
    medianDaysToSell: sold < MARKET_MIN_SAMPLE ? null : round(row?.days_to_sell ?? null),
    medianDaysListed: supply < MARKET_MIN_SAMPLE ? null : round(row?.days_listed ?? null),
    viewsPerListing: perListing(row?.views ?? 0, listings),
    viewingsPerListing: perListing(row?.viewings ?? 0, listings),
  };
}

interface StatsRow {
  key?: string;
  count: number;
  avg_price: string | null;
  median_price: string | null;
  min_price: string | null;
  max_price: string | null;
  avg_area: string | null;
}

function round(value: string | null): number | null {
  return value === null ? null : Math.round(Number(value));
}

function toStats(row: StatsRow | undefined): PriceStats {
  const count = row?.count ?? 0;
  if (!row || count < MARKET_MIN_SAMPLE) {
    return {
      count,
      avgPrice: null,
      medianPrice: null,
      minPrice: null,
      maxPrice: null,
      avgArea: null,
    };
  }
  return {
    count,
    avgPrice: round(row.avg_price),
    medianPrice: round(row.median_price),
    minPrice: round(row.min_price),
    maxPrice: round(row.max_price),
    avgArea: row.avg_area === null ? null : Math.round(Number(row.avg_area) * 10) / 10,
  };
}

const KEY_COLUMNS: Readonly<Record<MarketGroupBy, string>> = {
  ward: 'p.ward_id',
  propertyType: 'p.property_type',
};

function periodOf(query: MarketPriceQueryDto) {
  const months = query.months ?? MARKET_DEFAULT_MONTHS;
  const groupBy = query.groupBy ?? 'ward';
  const to = new Date();
  const from = new Date(to);
  from.setUTCMonth(from.getUTCMonth() - months);
  return { months, groupBy, from, to };
}

/**
 * Thống kê giá thị trường (TASK-145, MASTER_PLAN Phase 12): số tin, giá trung bình, giá giữa (median), thấp nhất,
 * cao nhất, diện tích trung bình theo phường/xã hoặc loại BĐS. Chỉ tính BĐS bán (SALE) người xem được xem
 * (`property.view`), trong công ty của họ.
 */
@Injectable()
export class MarketStatsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly properties: PropertiesService,
  ) {}

  async prices(
    actor: Actor,
    query: MarketPriceQueryDto,
    scopes: PropertyScopes,
  ): Promise<MarketPriceStats> {
    const { months, groupBy, from, to } = periodOf(query);

    const base = (): SelectQueryBuilder<Property> =>
      this.filtered(actor, query, scopes, from)
        .select('count(*)::int', 'count')
        .addSelect('avg(p.price)', 'avg_price')
        .addSelect('percentile_cont(0.5) WITHIN GROUP (ORDER BY p.price)', 'median_price')
        .addSelect('min(p.price)', 'min_price')
        .addSelect('max(p.price)', 'max_price')
        .addSelect('avg(p.area)', 'avg_area');

    const keyColumn = KEY_COLUMNS[groupBy];
    const [overall, rows] = await Promise.all([
      base().getRawOne<StatsRow>(),
      base()
        .addSelect(`${keyColumn}::text`, 'key')
        .groupBy(keyColumn)
        .orderBy('count(*)', 'DESC')
        .addOrderBy(keyColumn, 'ASC')
        .getRawMany<StatsRow & { key: string }>(),
    ]);

    const names = groupBy === 'ward' ? await this.wardNames(rows.map((row) => row.key)) : null;
    return {
      period: { from, to, months },
      groupBy,
      statuses: MARKET_STATUSES,
      minSample: MARKET_MIN_SAMPLE,
      overall: toStats(overall),
      groups: rows.map((row) => ({
        key: row.key,
        name: names?.get(row.key) ?? null,
        ...toStats(row),
      })),
    };
  }

  /**
   * Phân tích giá/m² (TASK-146): giá/m² trung bình, giá giữa, thấp nhất, cao nhất theo phường/xã hoặc loại BĐS,
   * và theo từng tháng đăng tin (giờ Việt Nam) để thấy xu hướng. Cùng tập BĐS với [prices]; giá/m² là cột
   * `price_per_m2` (giá chia diện tích).
   */
  async pricePerM2(
    actor: Actor,
    query: MarketPriceQueryDto,
    scopes: PropertyScopes,
  ): Promise<MarketPricePerM2> {
    const { months, groupBy, from, to } = periodOf(query);
    const base = (): SelectQueryBuilder<Property> =>
      this.filtered(actor, query, scopes, from)
        .andWhere('p.pricePerM2 IS NOT NULL')
        .select('count(*)::int', 'count')
        .addSelect('avg(p.price_per_m2)', 'avg')
        .addSelect('percentile_cont(0.5) WITHIN GROUP (ORDER BY p.price_per_m2)', 'median')
        .addSelect('min(p.price_per_m2)', 'min')
        .addSelect('max(p.price_per_m2)', 'max');

    const keyColumn = KEY_COLUMNS[groupBy];
    // Múi giờ là hằng số trong code, không phải dữ liệu người dùng.
    const monthColumn = `to_char(p.created_at AT TIME ZONE '${DISPLAY_TIME_ZONE}', 'YYYY-MM')`;
    const [overall, rows, monthRows] = await Promise.all([
      base().getRawOne<PerM2Row>(),
      base()
        .addSelect(`${keyColumn}::text`, 'key')
        .groupBy(keyColumn)
        .orderBy('count(*)', 'DESC')
        .addOrderBy(keyColumn, 'ASC')
        .getRawMany<PerM2Row & { key: string }>(),
      base()
        .addSelect(monthColumn, 'month')
        .groupBy(monthColumn)
        .getRawMany<PerM2Row & { month: string }>(),
    ]);

    const names = groupBy === 'ward' ? await this.wardNames(rows.map((row) => row.key)) : null;
    const byMonth = new Map(monthRows.map((row) => [row.month, row]));
    return {
      period: { from, to, months },
      groupBy,
      statuses: MARKET_STATUSES,
      minSample: MARKET_MIN_SAMPLE,
      overall: toPerM2(overall),
      groups: rows.map((row) => ({
        key: row.key,
        name: names?.get(row.key) ?? null,
        ...toPerM2(row),
      })),
      trend: monthsBetween(monthOf(from), monthOf(to)).map((month) => ({
        month,
        ...toPerM2(byMonth.get(month)),
      })),
    };
  }

  /**
   * Thanh khoản (TASK-147, MASTER_PLAN mục 21: cung, cầu, số ngày bán) theo phường/xã hoặc loại BĐS:
   * - Cung: tin bán đang bán, đang giao dịch hiện có (không kể ngày đăng).
   * - Đã bán: căn đang ở Đã bán mà lần chuyển sang Đã bán gần nhất (nhật ký `property.change_status`; BĐS cũ
   *   chưa có nhật ký thì lấy lúc sửa gần nhất) nằm trong kỳ.
   * - Cầu: lượt xem và lượt dẫn khách (trừ lịch huỷ) trong kỳ của các tin trên.
   */
  async liquidity(
    actor: Actor,
    query: MarketPriceQueryDto,
    scopes: PropertyScopes,
  ): Promise<MarketLiquidity> {
    const { months, groupBy, from, to } = periodOf(query);
    assertTenant(actor.tenantId);
    const listings = this.sales(actor, query, scopes)
      .andWhere('p.status IN (:...marketStatuses)', { marketStatuses: MARKET_STATUSES })
      .select('p.id', 'id')
      .addSelect(`${KEY_COLUMNS[groupBy]}::text`, 'key')
      .addSelect(`p.status <> 'SOLD'`, 'open')
      .addSelect('p.created_at', 'created_at')
      .addSelect(
        `CASE WHEN p.status = 'SOLD' THEN COALESCE((
           SELECT max(a.created_at) FROM audit_logs a
            WHERE a.tenant_id = p.tenant_id AND a.entity_type = 'property' AND a.entity_id = p.id
              AND a.action = 'property.change_status' AND a.changes -> 'status' ->> 1 = 'SOLD'
         ), p.updated_at) END`,
        'sold_at',
      );
    // Lượt xem, lượt dẫn khách trong kỳ gom theo BĐS một lần rồi nối vào (TASK-154), thay vì đếm từng BĐS.
    // Tổng chung và từng nhóm tính trong cùng một truy vấn (GROUPING SETS).
    const rows = await this.dataSource
      .createQueryBuilder()
      .from(`(${listings.getQuery()})`, 't')
      .setParameters(listings.getParameters())
      .leftJoin(
        (views) =>
          views
            .select('v.property_id', 'property_id')
            .addSelect('count(*)', 'n')
            .from('property_views', 'v')
            .where('v.tenant_id = :liquidityTenant AND v.viewed_at >= :liquidityFrom')
            .groupBy('v.property_id'),
        'pv',
        'pv.property_id = t.id',
      )
      .leftJoin(
        (viewings) =>
          viewings
            .select('ap.property_id', 'property_id')
            .addSelect('count(*)', 'n')
            .from('appointments', 'ap')
            .where('ap.tenant_id = :liquidityTenant AND ap.deleted_at IS NULL')
            .andWhere(`ap.status <> 'CANCELLED'`)
            .andWhere('ap.scheduled_at >= :liquidityFrom AND ap.scheduled_at < :liquidityTo')
            .groupBy('ap.property_id'),
        'av',
        'av.property_id = t.id',
      )
      .setParameters({ liquidityTenant: actor.tenantId, liquidityFrom: from, liquidityTo: to })
      .where('(t.open OR t.sold_at >= :liquidityFrom)')
      .select('t.key', 'key')
      .addSelect('GROUPING(t.key) = 1', 'overall')
      .addSelect('(count(*) FILTER (WHERE t.open))::int', 'supply')
      .addSelect('(count(*) FILTER (WHERE NOT t.open))::int', 'sold')
      .addSelect(
        `percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM t.sold_at - t.created_at) / 86400)
           FILTER (WHERE NOT t.open)`,
        'days_to_sell',
      )
      .addSelect(
        `percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM now() - t.created_at) / 86400)
           FILTER (WHERE t.open)`,
        'days_listed',
      )
      .addSelect('coalesce(sum(pv.n), 0)::int', 'views')
      .addSelect('coalesce(sum(av.n), 0)::int', 'viewings')
      .groupBy('GROUPING SETS ((t.key), ())')
      .getRawMany<LiquidityRow & { key: string | null; overall: boolean }>();
    const overall = rows.find((row) => row.overall);
    const groups = rows
      .filter((row): row is LiquidityRow & { key: string; overall: boolean } => !row.overall)
      .sort(
        (a, b) =>
          b.supply + b.sold - (a.supply + a.sold) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
      );

    const names = groupBy === 'ward' ? await this.wardNames(groups.map((row) => row.key)) : null;
    return {
      period: { from, to, months },
      groupBy,
      minSample: MARKET_MIN_SAMPLE,
      thresholds: { high: LIQUIDITY_HIGH_RATE, medium: LIQUIDITY_MEDIUM_RATE },
      overall: toLiquidity(overall),
      groups: groups.map((row) => ({
        key: row.key,
        name: names?.get(row.key) ?? null,
        ...toLiquidity(row),
      })),
    };
  }

  /** BĐS tính vào thống kê giá: tin đăng trong kỳ ở trạng thái MARKET_STATUSES, đã lọc theo [query]. */
  private filtered(
    actor: Actor,
    query: MarketPriceQueryDto,
    scopes: PropertyScopes,
    from: Date,
  ): SelectQueryBuilder<Property> {
    return this.sales(actor, query, scopes)
      .andWhere('p.status IN (:...marketStatuses)', { marketStatuses: MARKET_STATUSES })
      .andWhere('p.createdAt >= :marketFrom', { marketFrom: from });
  }

  /** BĐS bán (SALE) người xem được xem, lọc theo tỉnh, phường/xã, loại BĐS của [query]. */
  private sales(
    actor: Actor,
    query: MarketPriceQueryDto,
    scopes: PropertyScopes,
  ): SelectQueryBuilder<Property> {
    let builder = this.properties.visible(actor, scopes).andWhere(`p.transactionType = 'SALE'`);
    if (query.provinceId) {
      builder = builder.andWhere('p.provinceId = :provinceId', { provinceId: query.provinceId });
    }
    if (query.wardId) {
      builder = builder.andWhere('p.wardId = :wardId', { wardId: query.wardId });
    }
    if (query.propertyType) {
      builder = builder.andWhere('p.propertyType = :propertyType', {
        propertyType: query.propertyType,
      });
    }
    return builder;
  }

  private async wardNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) {
      return new Map();
    }
    const rows = (await this.dataSource.query(
      `SELECT id, name FROM wards WHERE id = ANY($1::uuid[])`,
      [ids],
    )) as { id: string; name: string }[];
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
