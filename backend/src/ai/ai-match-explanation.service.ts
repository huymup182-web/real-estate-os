import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { AuthenticatedUser } from '../auth/access-token.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import type { CustomerScopes } from '../customers/customers.service.js';
import { CRITERION_LABELS, type MatchExplanation } from '../matching/match-explanation.js';
import type { CriterionScore } from '../matching/match-score.js';
import { MatchingService, type PairMatch } from '../matching/matching.service.js';
import type { Actor, PropertyScopes } from '../properties/properties.service.js';
import { AiGatewayService } from './ai-gateway.service.js';
import {
  DIRECTION_LABELS,
  LEGAL_STATUS_LABELS,
  MATCH_EXPLANATION_SYSTEM_PROMPT,
  MATCH_EXPLANATION_TOOL,
  MAX_CONCERNS,
  MAX_STRENGTHS,
  matchExplanationTool,
  PROPERTY_TYPE_LABELS,
  ROAD_ACCESS_LABELS,
} from './match-explanation.tool.js';

const MAX_TEXT_LENGTH = 500;

/** Lời giải thích AI viết (TASK-135). */
export interface AiMatchText {
  summary: string;
  strengths: string[];
  concerns: string[];
  /** Câu gợi ý môi giới nói với khách. */
  pitch: string;
}

export interface AiMatchExplanation {
  property: { id: string; code: string; title: string };
  preferenceId: string;
  /** Điểm và tiêu chí do luật TASK-086 tính, không phải AI. */
  score: number;
  criteria: CriterionScore[];
  /** Lời giải thích dựng sẵn từ tiêu chí (TASK-089), dùng khi không cần AI. */
  explanation: MatchExplanation;
  ai: AiMatchText;
}

/** "3,3 tỷ", "850 triệu" (giá trị gửi LLM, giữ đúng số trong database). */
export function vnMoney(value: number): string {
  const format = (n: number) =>
    n.toLocaleString('vi-VN', { maximumFractionDigits: 3 }).replace(/\u00a0/g, ' ');
  return value >= 1_000_000_000
    ? `${format(value / 1_000_000_000)} tỷ`
    : `${format(value / 1_000_000)} triệu`;
}

function range(min: number | null, max: number | null, unit: (n: number) => string): string | null {
  if (min !== null && max !== null) {
    return `${unit(min)} – ${unit(max)}`;
  }
  if (min !== null) {
    return `từ ${unit(min)}`;
  }
  return max !== null ? `tối đa ${unit(max)}` : null;
}

function labels(values: string[] | null, map: Readonly<Record<string, string>>): string[] | null {
  return values?.length ? values.map((value) => map[value] ?? value) : null;
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT_LENGTH) : '';
}

function cleanList(value: unknown, max: number): string[] {
  return Array.isArray(value)
    ? value
        .map(cleanText)
        .filter((item) => item !== '')
        .slice(0, max)
    : [];
}

/**
 * AI giải thích vì sao một BĐS phù hợp với khách (TASK-135, MASTER_PLAN mục 8). Điểm vẫn do luật chấm
 * TASK-086 tính; AI chỉ viết lời giải thích từ dữ liệu thật của BĐS, nhu cầu khách và điểm từng tiêu chí.
 * Không gửi AI tên, số điện thoại, ghi chú của khách hay liên hệ chủ nhà, địa chỉ chi tiết, mô tả BĐS.
 */
@Injectable()
export class AiMatchExplanationService {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly matching: MatchingService,
    private readonly dataSource: DataSource,
  ) {}

  async explain(
    user: AuthenticatedUser,
    actor: Actor,
    customerId: string,
    propertyId: string,
    scopes: { property: PropertyScopes; customer: CustomerScopes },
  ): Promise<AiMatchExplanation> {
    const pair = await this.matching.pair(actor, customerId, propertyId, scopes);
    if (!pair) {
      throw new AppException(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        'Khách chưa có nhu cầu đang bật cùng loại giao dịch với BĐS này',
      );
    }

    const response = await this.gateway.complete(user, {
      feature: 'match_explanation',
      system: MATCH_EXPLANATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(await this.facts(pair)) }],
      tools: [matchExplanationTool],
      forceTool: MATCH_EXPLANATION_TOOL,
      maxTokens: 1024,
    });
    const input = response.toolCalls.find((call) => call.name === MATCH_EXPLANATION_TOOL)?.input;
    const summary = cleanText(input?.['summary']);
    if (!input || summary === '') {
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'AI chưa viết được lời giải thích, vui lòng thử lại',
      );
    }

    const { property } = pair;
    return {
      property: { id: property.id, code: property.code, title: property.title },
      preferenceId: pair.preferenceId,
      score: pair.score,
      criteria: pair.criteria,
      explanation: pair.explanation,
      ai: {
        summary,
        strengths: cleanList(input['strengths'], MAX_STRENGTHS),
        concerns: cleanList(input['concerns'], MAX_CONCERNS),
        pitch: cleanText(input['pitch']),
      },
    };
  }

  /** Dữ liệu gửi LLM: chỉ thông số BĐS, nhu cầu (không tên, liên hệ) và điểm từng tiêu chí. */
  private async facts(pair: PairMatch): Promise<Record<string, unknown>> {
    const { property, preference } = pair;
    const ids = [
      ...(preference.provinceIds ?? []),
      ...(preference.districtIds ?? []),
      ...(preference.wardIds ?? []),
    ];
    const names = new Map<string, string>();
    if (ids.length > 0) {
      const rows: { id: string; name: string }[] = await this.dataSource.query(
        `SELECT id, name FROM provinces WHERE id = ANY($1::uuid[])
         UNION ALL SELECT id, name FROM districts WHERE id = ANY($1::uuid[])
         UNION ALL SELECT id, name FROM wards WHERE id = ANY($1::uuid[])`,
        [ids],
      );
      for (const row of rows) {
        names.set(row.id, row.name);
      }
    }
    const areaNames = ids.map((id) => names.get(id)).filter((name) => name !== undefined);
    const m2 = (n: number) => `${n.toLocaleString('vi-VN')} m²`;

    return {
      bat_dong_san: {
        ma: property.code,
        tieu_de: property.title,
        loai: PROPERTY_TYPE_LABELS[property.propertyType] ?? property.propertyType,
        gia: vnMoney(property.price),
        dien_tich: m2(property.area),
        gia_m2: property.pricePerM2 === null ? null : `${vnMoney(property.pricePerM2)}/m²`,
        phong_ngu: property.bedrooms,
        phong_tam: property.bathrooms,
        so_tang: property.floors,
        huong: property.direction ? (DIRECTION_LABELS[property.direction] ?? null) : null,
        phap_ly: property.legalStatus ? (LEGAL_STATUS_LABELS[property.legalStatus] ?? null) : null,
        duong_vao: property.roadAccess ? (ROAD_ACCESS_LABELS[property.roadAccess] ?? null) : null,
        do_rong_duong_m: property.roadWidth,
        khu_vuc: `${property.wardName}, ${property.provinceName}`,
      },
      nhu_cau_khach: {
        loai_bds: labels(preference.propertyTypes, PROPERTY_TYPE_LABELS),
        ngan_sach: range(preference.budgetMin, preference.budgetMax, vnMoney),
        dien_tich: range(preference.areaMin, preference.areaMax, m2),
        phong_ngu_toi_thieu: preference.bedroomsMin,
        khu_vuc: areaNames.length > 0 ? areaNames : null,
        phap_ly: labels(preference.legalStatuses, LEGAL_STATUS_LABELS),
        duong_vao_toi_thieu: preference.minRoadAccess
          ? (ROAD_ACCESS_LABELS[preference.minRoadAccess] ?? null)
          : null,
      },
      diem_phu_hop: `${pair.score}%`,
      tieu_chi: pair.criteria.map((item) => ({
        ten: CRITERION_LABELS[item.criterion],
        trong_so: item.weight,
        muc_dat: `${Math.round(item.ratio * 100)}%`,
      })),
    };
  }
}
