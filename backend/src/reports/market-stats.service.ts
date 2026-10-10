import { Injectable } from '@nestjs/common';
import { DataSource, type SelectQueryBuilder } from 'typeorm';

import {
  type Actor,
  PropertiesService,
  type PropertyScopes,
} from '../properties/properties.service.js';
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
    const months = query.months ?? MARKET_DEFAULT_MONTHS;
    const groupBy = query.groupBy ?? 'ward';
    const to = new Date();
    const from = new Date(to);
    from.setUTCMonth(from.getUTCMonth() - months);

    const base = (): SelectQueryBuilder<Property> => {
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
      return builder
        .select('count(*)::int', 'count')
        .addSelect('avg(p.price)', 'avg_price')
        .addSelect('percentile_cont(0.5) WITHIN GROUP (ORDER BY p.price)', 'median_price')
        .addSelect('min(p.price)', 'min_price')
        .addSelect('max(p.price)', 'max_price')
        .addSelect('avg(p.area)', 'avg_area');
    };

    const keyColumn = groupBy === 'ward' ? 'p.ward_id' : 'p.property_type';
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
