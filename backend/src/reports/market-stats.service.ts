import { Injectable } from '@nestjs/common';
import { DataSource, type SelectQueryBuilder } from 'typeorm';

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

/** Tháng `YYYY-MM` của [date] theo giờ Việt Nam. */
function monthOf(date: Date): string {
  const parts = MONTH_FORMAT.formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}`;
}

/** Các tháng từ [first] đến [last] (gồm), dạng `YYYY-MM`. */
function monthsBetween(first: string, last: string): string[] {
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

  /** BĐS tính vào thống kê thị trường, đã lọc theo [query]. */
  private filtered(
    actor: Actor,
    query: MarketPriceQueryDto,
    scopes: PropertyScopes,
    from: Date,
  ): SelectQueryBuilder<Property> {
    let builder = this.properties
      .visible(actor, scopes)
      .andWhere(`p.transactionType = 'SALE'`)
      .andWhere('p.status IN (:...marketStatuses)', { marketStatuses: MARKET_STATUSES })
      .andWhere('p.createdAt >= :marketFrom', { marketFrom: from });
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
