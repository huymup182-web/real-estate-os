import { Injectable } from '@nestjs/common';
import type { SelectQueryBuilder } from 'typeorm';

import { CLOSED_CUSTOMER_STATUSES } from '../customers/customer-values.js';
import type { Customer } from '../customers/customer.entity.js';
import { type CustomerScopes, CustomersService } from '../customers/customers.service.js';
import {
  type Actor,
  PropertiesService,
  type PropertyScopes,
} from '../properties/properties.service.js';
import { explainMatch, type MatchExplanation } from './match-explanation.js';
import { type CriterionScore, type MatchPreference, scoreMatch } from './match-score.js';

/** Điểm tối thiểu để tính là phù hợp (mặc định Claude chọn ở TASK-087). */
export const MIN_MATCH_SCORE = 50;
/** Số kết quả mặc định và tối đa một lần. */
export const DEFAULT_MATCH_LIMIT = 20;
export const MAX_MATCH_LIMIT = 100;

export interface MatchOptions {
  minScore?: number;
  limit?: number;
}

/** BĐS đang bán/cho thuê mới được gợi ý cho khách (mặc định Claude chọn ở TASK-088). */
export const MATCHABLE_PROPERTY_STATUS = 'AVAILABLE';

/** Một BĐS phù hợp với khách: nhu cầu của khách cho điểm cao nhất và điểm đó. */
export interface PropertyMatch {
  property: {
    id: string;
    code: string;
    title: string;
    propertyType: string;
    transactionType: string;
    price: number;
    area: number;
  };
  preferenceId: string;
  score: number;
  criteria: CriterionScore[];
  /** Lời giải thích (TASK-089). */
  explanation: MatchExplanation;
}

/** Một khách phù hợp với BĐS: nhu cầu khớp nhất của khách và điểm của nhu cầu đó. */
export interface CustomerMatch {
  customer: { id: string; fullName: string; status: string; agentId: string | null };
  preferenceId: string;
  score: number;
  criteria: CriterionScore[];
  /** Lời giải thích (TASK-089). */
  explanation: MatchExplanation;
}

interface PreferenceRow {
  customerId: string;
  fullName: string;
  status: string;
  agentId: string | null;
  customerUpdatedAt: Date;
  preferenceId: string;
  transactionType: string;
  propertyTypes: string[] | null;
  budgetMin: string | null;
  budgetMax: string | null;
  areaMin: string | null;
  areaMax: string | null;
  bedroomsMin: number | null;
  provinceIds: string[] | null;
  districtIds: string[] | null;
  wardIds: string[] | null;
  legalStatuses: string[] | null;
  minRoadAccess: string | null;
}

/** Ghép BĐS với nhu cầu khách bằng luật chấm điểm của TASK-086. */
@Injectable()
export class MatchingService {
  constructor(
    private readonly properties: PropertiesService,
    private readonly customers: CustomersService,
  ) {}

  /**
   * Khách phù hợp với một BĐS (TASK-087).
   * - BĐS phải trong phạm vi xem của user (không thì 404); chỉ xét khách trong phạm vi `customer.view`.
   * - Chỉ xét nhu cầu đang bật, cùng loại giao dịch với BĐS, của khách chưa WON/LOST.
   * - Mỗi khách lấy nhu cầu điểm cao nhất; giữ khách đạt `minScore` (mặc định 50), điểm cao trước, cùng
   *   điểm thì khách cập nhật gần đây trước; tối đa `limit` (mặc định 20, tối đa 100).
   */
  async customersForProperty(
    actor: Actor,
    propertyId: string,
    scopes: { property: PropertyScopes; customer: CustomerScopes },
    options: MatchOptions = {},
  ): Promise<CustomerMatch[]> {
    const property = await this.properties.findOne(actor, propertyId, scopes.property);
    const rows = await this.preferences(actor, scopes.customer)
      .andWhere('cp.transaction_type = :transactionType', {
        transactionType: property.transactionType,
      })
      .andWhere('c.status NOT IN (:...closedStatuses)', {
        closedStatuses: [...CLOSED_CUSTOMER_STATUSES],
      })
      .getRawMany<PreferenceRow>();

    const best = new Map<
      string,
      { row: PreferenceRow; score: number; criteria: CriterionScore[] }
    >();
    for (const row of rows) {
      const result = scoreMatch(toPreference(row), property);
      const current = best.get(row.customerId);
      if (result.eligible && (!current || result.score > current.score)) {
        best.set(row.customerId, { row, score: result.score, criteria: result.criteria });
      }
    }
    return keepTop([...best.values()], options, (match) => [
      match.row.customerUpdatedAt,
      match.row.customerId,
    ]).map(({ row, score, criteria }) => ({
      customer: {
        id: row.customerId,
        fullName: row.fullName,
        status: row.status,
        agentId: row.agentId,
      },
      preferenceId: row.preferenceId,
      score,
      criteria,
      explanation: explainMatch(score, criteria),
    }));
  }

  /**
   * BĐS phù hợp với một khách (TASK-088).
   * - Khách phải trong phạm vi `customer.view` của user (không thì 404); chỉ xét BĐS user xem được, đang
   *   AVAILABLE, cùng loại giao dịch với một nhu cầu đang bật của khách.
   * - Mỗi BĐS lấy nhu cầu cho điểm cao nhất; giữ BĐS đạt `minScore` (mặc định 50), điểm cao trước, cùng
   *   điểm thì BĐS cập nhật gần đây trước; tối đa `limit` (mặc định 20, tối đa 100).
   * - Khách không có nhu cầu đang bật → danh sách rỗng.
   */
  async propertiesForCustomer(
    actor: Actor,
    customerId: string,
    scopes: { property: PropertyScopes; customer: CustomerScopes },
    options: MatchOptions = {},
  ): Promise<PropertyMatch[]> {
    await this.customers.findOne(actor, customerId, scopes.customer);
    const preferences = await this.preferences(actor, scopes.customer)
      .andWhere('c.id = :customerId', { customerId })
      .getRawMany<PreferenceRow>();
    if (preferences.length === 0) {
      return [];
    }
    const properties = await this.properties
      .visible(actor, scopes.property)
      .andWhere('p.status = :available', { available: MATCHABLE_PROPERTY_STATUS })
      .andWhere('p.transactionType IN (:...transactionTypes)', {
        transactionTypes: [...new Set(preferences.map((row) => row.transactionType))],
      })
      .getMany();

    const matches: { score: number; updatedAt: Date; match: PropertyMatch }[] = [];
    for (const property of properties) {
      let best: { row: PreferenceRow; score: number; criteria: CriterionScore[] } | undefined;
      for (const row of preferences) {
        const result = scoreMatch(toPreference(row), property);
        if (result.eligible && (!best || result.score > best.score)) {
          best = { row, score: result.score, criteria: result.criteria };
        }
      }
      if (best) {
        matches.push({
          score: best.score,
          updatedAt: property.updatedAt,
          match: {
            property: {
              id: property.id,
              code: property.code,
              title: property.title,
              propertyType: property.propertyType,
              transactionType: property.transactionType,
              price: property.price,
              area: property.area,
            },
            preferenceId: best.row.preferenceId,
            score: best.score,
            criteria: best.criteria,
            explanation: explainMatch(best.score, best.criteria),
          },
        });
      }
    }
    return keepTop(matches, options, (item) => [item.updatedAt, item.match.property.id]).map(
      (item) => item.match,
    );
  }

  /** Nhu cầu đang bật, chưa xoá của khách trong phạm vi xem, kèm thông tin khách. */
  private preferences(actor: Actor, scopes: CustomerScopes): SelectQueryBuilder<Customer> {
    return this.customers
      .visible(actor, scopes)
      .innerJoin(
        'customer_preferences',
        'cp',
        'cp.tenant_id = c.tenant_id AND cp.customer_id = c.id AND cp.deleted_at IS NULL AND cp.is_active',
      )
      .select('c.id', 'customerId')
      .addSelect('c.full_name', 'fullName')
      .addSelect('c.status', 'status')
      .addSelect('c.agent_id', 'agentId')
      .addSelect('c.updated_at', 'customerUpdatedAt')
      .addSelect('cp.id', 'preferenceId')
      .addSelect('cp.transaction_type', 'transactionType')
      .addSelect('cp.property_types', 'propertyTypes')
      .addSelect('cp.budget_min', 'budgetMin')
      .addSelect('cp.budget_max', 'budgetMax')
      .addSelect('cp.area_min', 'areaMin')
      .addSelect('cp.area_max', 'areaMax')
      .addSelect('cp.bedrooms_min', 'bedroomsMin')
      .addSelect('cp.province_ids', 'provinceIds')
      .addSelect('cp.district_ids', 'districtIds')
      .addSelect('cp.ward_ids', 'wardIds')
      .addSelect('cp.legal_statuses', 'legalStatuses')
      .addSelect('cp.min_road_access', 'minRoadAccess');
  }
}

/**
 * Lọc theo `minScore`, xếp điểm cao trước rồi theo `tieBreak` (thời điểm cập nhật mới trước, rồi id), cắt
 * theo `limit`.
 */
function keepTop<T extends { score: number }>(
  matches: T[],
  options: MatchOptions,
  tieBreak: (match: T) => [Date, string],
): T[] {
  const minScore = options.minScore ?? MIN_MATCH_SCORE;
  const limit = Math.min(options.limit ?? DEFAULT_MATCH_LIMIT, MAX_MATCH_LIMIT);
  return matches
    .filter((match) => match.score >= minScore)
    .sort((a, b) => {
      const [aTime, aId] = tieBreak(a);
      const [bTime, bId] = tieBreak(b);
      return (
        b.score - a.score ||
        new Date(bTime).getTime() - new Date(aTime).getTime() ||
        aId.localeCompare(bId)
      );
    })
    .slice(0, limit);
}

/** PostgreSQL trả bigint/numeric dạng chuỗi. */
function toNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function toPreference(row: PreferenceRow): MatchPreference {
  return {
    transactionType: row.transactionType,
    propertyTypes: row.propertyTypes,
    budgetMin: toNumber(row.budgetMin),
    budgetMax: toNumber(row.budgetMax),
    areaMin: toNumber(row.areaMin),
    areaMax: toNumber(row.areaMax),
    bedroomsMin: row.bedroomsMin,
    provinceIds: row.provinceIds,
    districtIds: row.districtIds,
    wardIds: row.wardIds,
    legalStatuses: row.legalStatuses,
    minRoadAccess: row.minRoadAccess,
  };
}
