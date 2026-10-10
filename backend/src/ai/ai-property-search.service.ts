import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { AuthenticatedUser } from '../auth/access-token.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { keywordTerms, MAX_KEYWORD_LENGTH } from '../search/keyword.js';
import { normalizeSearchFilters } from '../search/search-filters.js';
import { AiGatewayService } from './ai-gateway.service.js';
import {
  PROPERTY_SEARCH_SYSTEM_PROMPT,
  PROPERTY_SEARCH_TOOL,
  propertySearchTool,
} from './property-search.tool.js';

/** Bộ lọc LLM được điền thẳng (cùng tên tham số của `GET /properties`). */
const FILTER_KEYS = [
  'priceMin',
  'priceMax',
  'areaMin',
  'areaMax',
  'propertyType',
  'bedroomsMin',
  'legalStatus',
  'direction',
  'roadAccess',
  'sort',
] as const;
const INTEGER_KEYS: readonly string[] = ['priceMin', 'priceMax', 'bedroomsMin'];

/** Tiền tố đơn vị hành chính bỏ đi khi so tên ("Phường Vĩnh Hải" = "Vĩnh Hải"). */
const UNIT_PREFIX = /^(tinh|thanh pho|tp|phuong|xa|dac khu|thi tran) /;
const MAX_EXPLANATION_LENGTH = 500;

export interface AiPropertySearchResult {
  /** Bộ lọc đã kiểm bằng đúng schema của `GET /properties`; app gửi lại nguyên để lấy kết quả. */
  filters: Record<string, unknown>;
  /** Câu AI nói lại các điều kiện đã hiểu. */
  explanation: string;
  /** Tên khu vực không tìm thấy trong danh mục địa giới, nên chưa lọc theo. */
  unresolved: string[];
}

interface LocationRow {
  id: string;
  name: string;
  province_id?: string;
}

/** Tên địa giới → chữ thường không dấu, bỏ tiền tố đơn vị, để so tên LLM trả với danh mục. */
export function normalizePlaceName(name: string): string {
  return keywordTerms(name.replace(/^tp\./i, 'tp ')).join(' ').replace(UNIT_PREFIX, '');
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Tìm BĐS bằng câu tự nhiên (TASK-134, MASTER_PLAN mục 6): LLM chỉ đổi câu thành bộ lọc có cấu trúc,
 * không chạm database. Backend đổi tên khu vực ra id, kiểm bộ lọc bằng schema của `GET /properties`
 * rồi trả lại để app tìm như bộ lọc thường (quyền, phạm vi xem, tenant giữ nguyên).
 */
@Injectable()
export class AiPropertySearchService {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly dataSource: DataSource,
  ) {}

  async search(user: AuthenticatedUser, query: string): Promise<AiPropertySearchResult> {
    const response = await this.gateway.complete(user, {
      feature: 'property_search',
      system: PROPERTY_SEARCH_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: query }],
      tools: [propertySearchTool],
      forceTool: PROPERTY_SEARCH_TOOL,
      maxTokens: 1024,
    });
    const input = response.toolCalls.find((call) => call.name === PROPERTY_SEARCH_TOOL)?.input;
    if (!input) {
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'AI chưa đọc được câu tìm kiếm, vui lòng thử lại',
      );
    }

    const { filters, unresolved } = await this.filtersFrom(input);
    return {
      filters,
      explanation: (text(input['explanation']) ?? '').slice(0, MAX_EXPLANATION_LENGTH),
      unresolved,
    };
  }

  /**
   * Tham số LLM điền theo schema `propertySearchTool` → bộ lọc đã kiểm của `GET /properties` và tên khu vực
   * chưa tìm thấy. Dùng chung với Copilot (TASK-143).
   */
  async filtersFrom(
    input: Record<string, unknown>,
  ): Promise<{ filters: Record<string, unknown>; unresolved: string[] }> {
    const raw: Record<string, unknown> = {};
    for (const key of FILTER_KEYS) {
      const value = input[key];
      if (value === undefined || value === null) {
        continue;
      }
      raw[key] =
        INTEGER_KEYS.includes(key) && typeof value === 'number' ? Math.round(value) : value;
    }

    const unresolved: string[] = [];
    await this.resolveLocation(input, raw, unresolved);

    const keyword = text(input['keyword']);
    if (keyword) {
      raw['q'] = keyword.slice(0, MAX_KEYWORD_LENGTH).trim();
    }

    return { filters: validFilters(raw), unresolved };
  }

  /** province/ward/place (tên) → provinceId/wardId. Tên không khớp đúng một khu vực thì ghi vào `unresolved`. */
  private async resolveLocation(
    input: Record<string, unknown>,
    raw: Record<string, unknown>,
    unresolved: string[],
  ): Promise<void> {
    const provinces: LocationRow[] = await this.dataSource.query(
      `SELECT id, name FROM provinces WHERE is_active`,
    );
    const findProvince = (name: string): string | null => {
      const wanted = normalizePlaceName(name);
      const matches = provinces.filter((p) => normalizePlaceName(p.name) === wanted);
      return matches.length === 1 ? (matches[0]?.id ?? null) : null;
    };

    const province = text(input['province']);
    if (province) {
      const id = findProvince(province);
      if (id) {
        raw['provinceId'] = id;
      } else {
        unresolved.push(province);
      }
    }

    const place = text(input['place']);
    if (place) {
      // Địa danh trùng tên tỉnh (vd "Đà Nẵng") thì lọc theo tỉnh; còn lại (thành phố, quận cũ) chưa lọc được.
      const id = findProvince(place);
      if (id && (raw['provinceId'] === undefined || raw['provinceId'] === id)) {
        raw['provinceId'] = id;
      } else if (!id) {
        unresolved.push(place);
      }
    }

    const ward = text(input['ward']);
    if (ward) {
      const wanted = normalizePlaceName(ward);
      const lastTerm = wanted.split(' ').at(-1) ?? '';
      const provinceId = raw['provinceId'] as string | undefined;
      const candidates: LocationRow[] = await this.dataSource.query(
        `SELECT id, name, province_id FROM wards
          WHERE is_active AND ($1::uuid IS NULL OR province_id = $1)
            AND immutable_unaccent(lower(name)) LIKE '%' || $2 || '%'`,
        [provinceId ?? null, lastTerm],
      );
      const matches = candidates.filter((w) => normalizePlaceName(w.name) === wanted);
      const [match] = matches;
      if (matches.length === 1 && match) {
        raw['wardId'] = match.id;
        raw['provinceId'] = match.province_id;
      } else {
        unresolved.push(ward);
      }
    }
  }
}

/**
 * Kiểm bộ lọc bằng schema của `GET /properties`. LLM điền sai trường nào (vd giá min > max, giá trị lạ) thì
 * bỏ trường đó thay vì báo lỗi cả câu tìm kiếm.
 */
function validFilters(raw: Record<string, unknown>): Record<string, unknown> {
  let current = raw;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return normalizeSearchFilters(current, '');
    } catch (error) {
      if (!(error instanceof AppException) || !error.details?.length) {
        throw error;
      }
      const bad = new Set(error.details.map((d) => (d.field ?? '').split('.')[0]));
      current = Object.fromEntries(Object.entries(current).filter(([key]) => !bad.has(key)));
    }
  }
  return {};
}
