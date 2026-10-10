import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/access-token.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import {
  type Actor,
  PropertiesService,
  type PropertyScopes,
} from '../properties/properties.service.js';
import { AiGatewayService } from './ai-gateway.service.js';
import {
  DIRECTION_LABELS,
  LEGAL_STATUS_LABELS,
  PROPERTY_STATUS_LABELS,
  ROAD_ACCESS_LABELS,
  propertyFacts,
  vnArea,
  vnMoney,
} from './property-facts.js';
import { hidePhones } from './redact.js';
import {
  VALUATION_AREA_RATIO,
  VALUATION_MAX_ADJUSTMENT,
  VALUATION_MAX_COMPARABLES,
  VALUATION_MIN_COMPARABLES,
  VALUATION_MONTHS,
  VALUATION_RADIUS_M,
  type ValuationConfidence,
  clampAdjustment,
  differencePercent,
  roundMillion,
  valuationBase,
  valuationConfidence,
} from './valuation.js';
import {
  VALUATION_FACTOR_MAX,
  VALUATION_IMPACTS,
  VALUATION_MAX_FACTORS,
  VALUATION_NOTE_MAX,
  VALUATION_SUMMARY_MAX,
  VALUATION_TOOL,
  type ValuationImpact,
  valuationSystemPrompt,
  valuationTool,
} from './valuation.tool.js';

/** Ghi chú môi giới gửi LLM tối đa chừng này ký tự. */
const DESCRIPTION_MAX = 2000;

/** Một BĐS tương tự dùng để định giá. */
export interface ValuationComparable {
  id: string;
  code: string;
  title: string;
  status: string;
  price: number;
  area: number;
  pricePerM2: number;
  /** Cùng phường/xã với BĐS cần định giá (không thì nằm trong bán kính VALUATION_RADIUS_M). */
  sameWard: boolean;
}

export interface ValuationFactor {
  factor: string;
  impact: ValuationImpact;
  note: string;
}

/** Kết quả định giá AI (TASK-149). Giá làm tròn tới triệu đồng. Chỉ là tham khảo: không lưu vào BĐS. */
export interface AiValuation {
  property: { id: string; code: string };
  /** Giá ước tính = giá gốc × (1 + adjustmentPercent/100). */
  estimate: { price: number; pricePerM2: number };
  /** Khoảng giá: phân vị 25..75 giá/m² của BĐS tương tự × diện tích, cùng mức chỉnh. */
  range: { low: number; high: number };
  /** Giá gốc từ giá/m² trung vị của BĐS tương tự. */
  base: { price: number; pricePerM2: number };
  adjustmentPercent: number;
  maxAdjustmentPercent: number;
  confidence: ValuationConfidence;
  factors: ValuationFactor[];
  summary: string;
  comparables: ValuationComparable[];
  askingPrice: number;
  /** Giá chào bán cao (+) hay thấp (−) hơn giá ước tính bao nhiêu %. */
  askingVsEstimatePercent: number | null;
}

interface ComparableRow {
  id: string;
  code: string;
  title: string;
  status: string;
  price: string;
  area: string;
  price_per_m2: string;
  bedrooms: number | null;
  floors: number | null;
  direction: string | null;
  legal_status: string | null;
  road_access: string | null;
  road_width: string | null;
  same_ward: boolean;
}

/** Vị trí BĐS cần định giá, lấy trong database (không lộ toạ độ ra kết quả). */
const SUBJECT_LOCATION =
  '(SELECT s.location FROM properties s WHERE s.id = :valuationSubjectId AND s.tenant_id = :valuationTenantId)';

function label(map: Readonly<Record<string, string>>, value: string | null): string | null {
  return value ? (map[value] ?? null) : null;
}

function clean(value: unknown, max: number): string {
  return typeof value === 'string'
    ? hidePhones(value).replace(/\s+/g, ' ').trim().slice(0, max).trim()
    : '';
}

function factorsOf(value: unknown): ValuationFactor[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item: unknown) => {
      const record = (item ?? {}) as Record<string, unknown>;
      const impact = VALUATION_IMPACTS.find((option) => option === record['impact']) ?? 'NEUTRAL';
      return {
        factor: clean(record['factor'], VALUATION_FACTOR_MAX),
        impact,
        note: clean(record['note'], VALUATION_NOTE_MAX),
      };
    })
    .filter((factor) => factor.factor !== '' && factor.note !== '')
    .slice(0, VALUATION_MAX_FACTORS);
}

/**
 * Định giá AI prototype (TASK-149, MASTER_PLAN mục 18): giá gốc từ giá/m² các BĐS tương tự cùng công ty mà người
 * dùng được xem (cùng loại, cùng kiểu giao dịch, diện tích gần, cùng phường hoặc trong bán kính 2 km), AI chỉ
 * chỉnh trong ±VALUATION_MAX_ADJUSTMENT% và nêu lý do. Không gửi LLM địa chỉ, toạ độ, chủ nhà, môi giới,
 * hoa hồng, giá chào bán.
 */
@Injectable()
export class AiValuationService {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly properties: PropertiesService,
  ) {}

  async value(
    user: AuthenticatedUser,
    actor: Actor,
    propertyId: string,
    scopes: PropertyScopes,
  ): Promise<AiValuation> {
    const property = await this.properties.findOne(actor, propertyId, scopes);
    const rows = await this.comparables(actor, scopes, property);
    if (rows.length < VALUATION_MIN_COMPARABLES) {
      throw new AppException(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        `Chưa đủ BĐS tương tự để định giá (cần ít nhất ${VALUATION_MIN_COMPARABLES}, có ${rows.length})`,
      );
    }
    const comparables: ValuationComparable[] = rows.map((row) => ({
      id: row.id,
      code: row.code,
      title: row.title,
      status: row.status,
      price: Number(row.price),
      area: Number(row.area),
      pricePerM2: Number(row.price_per_m2),
      sameWard: row.same_ward,
    }));
    const base = valuationBase(
      comparables.map((comparable) => comparable.pricePerM2),
      property.area,
    );
    const maxAdjustment = VALUATION_MAX_ADJUSTMENT;

    const facts = {
      bat_dong_san: Object.fromEntries(
        Object.entries(propertyFacts(property)).filter(
          ([key]) => !['tieu_de', 'gia', 'gia_m2'].includes(key),
        ),
      ),
      mo_ta: property.description
        ? hidePhones(property.description).slice(0, DESCRIPTION_MAX)
        : null,
      bds_tuong_tu: rows.map((row) => ({
        ma: row.code,
        trang_thai: label(PROPERTY_STATUS_LABELS, row.status),
        cung_phuong: row.same_ward,
        gia: vnMoney(Number(row.price)),
        dien_tich: vnArea(Number(row.area)),
        gia_m2: `${vnMoney(Number(row.price_per_m2))}/m²`,
        phong_ngu: row.bedrooms,
        so_tang: row.floors,
        huong: label(DIRECTION_LABELS, row.direction),
        phap_ly: label(LEGAL_STATUS_LABELS, row.legal_status),
        duong_vao: label(ROAD_ACCESS_LABELS, row.road_access),
        do_rong_duong_m: row.road_width === null ? null : Number(row.road_width),
      })),
      gia_goc: {
        gia: vnMoney(roundMillion(base.price)),
        gia_m2: `${vnMoney(Math.round(base.pricePerM2))}/m²`,
        khoang_gia: `${vnMoney(roundMillion(base.low))} – ${vnMoney(roundMillion(base.high))}`,
        so_bds_tuong_tu: rows.length,
        gioi_han_chinh: `±${maxAdjustment}%`,
      },
    };

    const response = await this.gateway.complete(user, {
      feature: 'valuation',
      system: valuationSystemPrompt(maxAdjustment),
      messages: [{ role: 'user', content: JSON.stringify(facts) }],
      tools: [valuationTool(maxAdjustment)],
      forceTool: VALUATION_TOOL,
      maxTokens: 1500,
    });
    const input = response.toolCalls.find((call) => call.name === VALUATION_TOOL)?.input;
    const summary = clean(input?.['summary'], VALUATION_SUMMARY_MAX);
    if (summary === '') {
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'AI chưa định giá được BĐS này, vui lòng thử lại',
      );
    }
    const adjustmentPercent = clampAdjustment(input?.['adjustmentPercent'], maxAdjustment);
    const factor = 1 + adjustmentPercent / 100;
    const estimate = roundMillion(base.price * factor);

    return {
      property: { id: property.id, code: property.code },
      estimate: { price: estimate, pricePerM2: Math.round(estimate / property.area) },
      range: { low: roundMillion(base.low * factor), high: roundMillion(base.high * factor) },
      base: { price: roundMillion(base.price), pricePerM2: Math.round(base.pricePerM2) },
      adjustmentPercent,
      maxAdjustmentPercent: maxAdjustment,
      confidence: valuationConfidence(rows.length, base.spread),
      factors: factorsOf(input?.['factors']),
      summary,
      comparables,
      askingPrice: property.price,
      askingVsEstimatePercent: differencePercent(property.price, estimate),
    };
  }

  /**
   * BĐS tương tự trong phạm vi xem của người dùng: cùng kiểu giao dịch và loại, đang bán/đang giao dịch/đã bán,
   * có giá/m², đăng trong VALUATION_MONTHS tháng, diện tích từ 1/2 đến 2 lần. Cùng phường trước, rồi gần hơn,
   * rồi diện tích sát hơn.
   */
  private async comparables(
    actor: Actor,
    scopes: PropertyScopes,
    property: {
      id: string;
      transactionType: string;
      propertyType: string;
      wardId: string;
      area: number;
    },
  ): Promise<ComparableRow[]> {
    const since = new Date();
    since.setUTCMonth(since.getUTCMonth() - VALUATION_MONTHS);
    return this.properties
      .visible(actor, scopes)
      .select('p.id', 'id')
      .addSelect('p.code', 'code')
      .addSelect('p.title', 'title')
      .addSelect('p.status', 'status')
      .addSelect('p.price', 'price')
      .addSelect('p.area', 'area')
      .addSelect('p.price_per_m2', 'price_per_m2')
      .addSelect('p.bedrooms', 'bedrooms')
      .addSelect('p.floors', 'floors')
      .addSelect('p.direction', 'direction')
      .addSelect('p.legal_status', 'legal_status')
      .addSelect('p.road_access', 'road_access')
      .addSelect('p.road_width', 'road_width')
      .addSelect('(p.ward_id = :valuationWardId)', 'same_ward')
      .andWhere('p.id <> :valuationSubjectId')
      .andWhere('p.transactionType = :valuationTransactionType')
      .andWhere('p.propertyType = :valuationPropertyType')
      .andWhere("p.status IN ('AVAILABLE', 'PENDING', 'SOLD')")
      .andWhere('p.pricePerM2 IS NOT NULL')
      .andWhere('p.createdAt >= :valuationSince')
      .andWhere('p.area BETWEEN :valuationMinArea AND :valuationMaxArea')
      .andWhere(
        `(p.ward_id = :valuationWardId OR ST_DWithin(p.location, ${SUBJECT_LOCATION}, :valuationRadius))`,
      )
      .orderBy('(p.ward_id = :valuationWardId)', 'DESC')
      .addOrderBy(`ST_Distance(p.location, ${SUBJECT_LOCATION})`, 'ASC', 'NULLS LAST')
      .addOrderBy('ABS(LN(p.area / CAST(:valuationArea AS numeric)))', 'ASC')
      .addOrderBy('p.created_at', 'DESC')
      .limit(VALUATION_MAX_COMPARABLES)
      .setParameters({
        valuationSubjectId: property.id,
        valuationTenantId: actor.tenantId,
        valuationWardId: property.wardId,
        valuationTransactionType: property.transactionType,
        valuationPropertyType: property.propertyType,
        valuationSince: since,
        valuationMinArea: property.area / VALUATION_AREA_RATIO,
        valuationMaxArea: property.area * VALUATION_AREA_RATIO,
        valuationRadius: VALUATION_RADIUS_M,
        valuationArea: property.area,
      })
      .getRawMany<ComparableRow>();
  }
}
