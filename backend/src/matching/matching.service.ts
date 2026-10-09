import { Injectable } from '@nestjs/common';

import { CLOSED_CUSTOMER_STATUSES } from '../customers/customer-values.js';
import { type CustomerScopes, CustomersService } from '../customers/customers.service.js';
import {
  type Actor,
  PropertiesService,
  type PropertyScopes,
} from '../properties/properties.service.js';
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

/** Một khách phù hợp với BĐS: nhu cầu khớp nhất của khách và điểm của nhu cầu đó. */
export interface CustomerMatch {
  customer: { id: string; fullName: string; status: string; agentId: string | null };
  preferenceId: string;
  score: number;
  criteria: CriterionScore[];
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
    const rows = await this.customers
      .visible(actor, scopes.customer)
      .innerJoin(
        'customer_preferences',
        'cp',
        `cp.tenant_id = c.tenant_id AND cp.customer_id = c.id AND cp.deleted_at IS NULL
           AND cp.is_active AND cp.transaction_type = :transactionType`,
        { transactionType: property.transactionType },
      )
      .andWhere('c.status NOT IN (:...closedStatuses)', {
        closedStatuses: [...CLOSED_CUSTOMER_STATUSES],
      })
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
      .addSelect('cp.min_road_access', 'minRoadAccess')
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
    const minScore = options.minScore ?? MIN_MATCH_SCORE;
    const limit = Math.min(options.limit ?? DEFAULT_MATCH_LIMIT, MAX_MATCH_LIMIT);
    return [...best.values()]
      .filter((match) => match.score >= minScore)
      .sort(
        (a, b) =>
          b.score - a.score ||
          new Date(b.row.customerUpdatedAt).getTime() -
            new Date(a.row.customerUpdatedAt).getTime() ||
          a.row.customerId.localeCompare(b.row.customerId),
      )
      .slice(0, limit)
      .map(({ row, score, criteria }) => ({
        customer: {
          id: row.customerId,
          fullName: row.fullName,
          status: row.status,
          agentId: row.agentId,
        },
        preferenceId: row.preferenceId,
        score,
        criteria,
      }));
  }
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
