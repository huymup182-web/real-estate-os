import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { AppException, type ErrorDetail } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { toErrorDetails } from '../common/validation/validation.pipe.js';
import { PropertySearchQueryDto } from './property-search-query.dto.js';

/** Cặp khoảng min/max của bộ lọc; min > max → lỗi ở trường max. */
const RANGES = [
  ['priceMin', 'priceMax'],
  ['areaMin', 'areaMax'],
  ['bedroomsMin', 'bedroomsMax'],
  ['bathroomsMin', 'bathroomsMax'],
  ['roadWidthMin', 'roadWidthMax'],
] as const;

/** Tham số phân trang không thuộc bộ lọc, không lưu trong tìm kiếm đã lưu. */
const PAGINATION_KEYS = ['page', 'pageSize'] as const;

/** Lỗi khoảng min > max của bộ lọc tìm kiếm (TASK-065..072). */
export function searchRangeErrors(query: PropertySearchQueryDto, prefix = ''): ErrorDetail[] {
  return RANGES.flatMap(([min, max]) => {
    const low = query[min];
    const high = query[max];
    return low !== undefined && high !== undefined && low > high
      ? [{ field: `${prefix}${max}`, message: `${max} phải lớn hơn hoặc bằng ${min}` }]
      : [];
  });
}

/**
 * Kiểm bộ lọc tìm kiếm gửi dạng object (saved search, TASK-075) bằng đúng schema của `GET /properties`
 * (phase0/05-API-CONVENTIONS.md mục 5). Trả bộ lọc đã chuẩn hoá (trim, tách danh sách, đổi số) chỉ gồm
 * các trường có giá trị. Sai → 400 với `field` dạng `filters.priceMax`.
 */
export function normalizeSearchFilters(raw: object, prefix = 'filters.'): Record<string, unknown> {
  const pagination = PAGINATION_KEYS.filter((key) => key in raw);
  if (pagination.length > 0) {
    throw new AppException(
      ErrorCode.VALIDATION_ERROR,
      undefined,
      pagination.map((key) => ({
        field: `${prefix}${key}`,
        message: `${key} là tham số phân trang, không lưu trong bộ lọc`,
      })),
    );
  }
  const dto = plainToInstance(PropertySearchQueryDto, raw);
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
    validationError: { target: false, value: false },
  });
  const details = [
    ...toErrorDetails(errors).map((detail) => ({ ...detail, field: `${prefix}${detail.field}` })),
    ...(errors.length === 0 ? searchRangeErrors(dto, prefix) : []),
  ];
  if (details.length > 0) {
    throw new AppException(ErrorCode.VALIDATION_ERROR, undefined, details);
  }
  const filters: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(dto)) {
    if (value !== undefined && !(PAGINATION_KEYS as readonly string[]).includes(key)) {
      filters[key] = value;
    }
  }
  return filters;
}
