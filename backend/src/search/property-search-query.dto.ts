import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { PaginationQueryDto } from '../common/response/pagination-query.dto.js';
import { PROPERTY_TYPES } from '../properties/property-values.js';
import { MAX_KEYWORD_LENGTH } from './keyword.js';

/** Diện tích lớn nhất cột `properties.area` nhận (numeric(12, 2)). */
const MAX_AREA = 9_999_999_999.99;
const AREA_NUMBER = { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false };

/** Số phòng lớn nhất cột `bedrooms`/`bathrooms` nhận (smallint). */
const MAX_ROOMS = 32_767;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Danh sách trong query: `?x=A,B` hoặc `?x=A&x=B` → `['A', 'B']` (bỏ khoảng trắng, phần rỗng và trùng).
 * Giá trị không phải chuỗi giữ nguyên để validator báo lỗi.
 */
const commaList = ({ value }: { value: unknown }): unknown => {
  const parts = Array.isArray(value) ? value : [value];
  if (!parts.every((part) => typeof part === 'string')) {
    return value;
  }
  return [
    ...new Set(
      (parts as string[])
        .flatMap((part) => part.split(','))
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    ),
  ];
};

/**
 * Tham số tìm kiếm BĐS trên `GET /properties` (Phase 5, phase0/05-API-CONVENTIONS.md mục 5). Các bộ lọc
 * giá, diện tích, khu vực… thêm vào class này ở TASK-065..072 để saved search dùng chung một schema.
 */
export class PropertySearchQueryDto extends PaginationQueryDto {
  /** Từ khoá: tìm trong tiêu đề, mô tả, địa chỉ (có dấu hay không dấu), hoặc đúng mã BĐS. */
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'q phải là chuỗi' })
  @MaxLength(MAX_KEYWORD_LENGTH, { message: `q tối đa ${MAX_KEYWORD_LENGTH} ký tự` })
  q?: string;

  /** Giá thấp nhất, đồng (gồm cả giá này). */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'priceMin phải là số nguyên (đồng)' })
  @Min(0, { message: 'priceMin không được âm' })
  @Max(Number.MAX_SAFE_INTEGER)
  priceMin?: number;

  /** Giá cao nhất, đồng (gồm cả giá này). Phải ≥ priceMin. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'priceMax phải là số nguyên (đồng)' })
  @Min(0, { message: 'priceMax không được âm' })
  @Max(Number.MAX_SAFE_INTEGER)
  priceMax?: number;

  /** Diện tích nhỏ nhất, m², tối đa 2 chữ số thập phân (gồm cả mốc này). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber(AREA_NUMBER, { message: 'areaMin phải là số, tối đa 2 chữ số thập phân' })
  @Min(0, { message: 'areaMin không được âm' })
  @Max(MAX_AREA)
  areaMin?: number;

  /** Diện tích lớn nhất, m² (gồm cả mốc này). Phải ≥ areaMin. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber(AREA_NUMBER, { message: 'areaMax phải là số, tối đa 2 chữ số thập phân' })
  @Min(0, { message: 'areaMax không được âm' })
  @Max(MAX_AREA)
  areaMax?: number;

  /** Tỉnh/thành (TASK-067). */
  @IsOptional()
  @IsUUID('all', { message: 'provinceId phải là UUID' })
  provinceId?: string;

  /** Quận/huyện cũ (trước 07/2025), cho BĐS còn ghi theo địa chỉ cũ. */
  @IsOptional()
  @IsUUID('all', { message: 'districtId phải là UUID' })
  districtId?: string;

  /** Phường/xã. */
  @IsOptional()
  @IsUUID('all', { message: 'wardId phải là UUID' })
  wardId?: string;

  /** Loại BĐS (TASK-068), một hoặc nhiều loại: `?propertyType=HOUSE,APARTMENT`; khớp một trong các loại. */
  @IsOptional()
  @Transform(commaList)
  @IsArray({ message: 'propertyType phải là danh sách loại BĐS' })
  @ArrayNotEmpty({ message: 'propertyType không được để trống' })
  @IsIn(PROPERTY_TYPES, {
    each: true,
    message: `propertyType phải là một hoặc nhiều loại trong: ${PROPERTY_TYPES.join(', ')}`,
  })
  propertyType?: string[];

  /** Số phòng ngủ ít nhất (gồm cả mốc này) (TASK-069). BĐS chưa ghi số phòng không khớp. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'bedroomsMin phải là số nguyên' })
  @Min(0, { message: 'bedroomsMin không được âm' })
  @Max(MAX_ROOMS, { message: `bedroomsMin tối đa ${MAX_ROOMS}` })
  bedroomsMin?: number;

  /** Số phòng ngủ nhiều nhất (gồm cả mốc này) Phải ≥ bedroomsMin. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'bedroomsMax phải là số nguyên' })
  @Min(0, { message: 'bedroomsMax không được âm' })
  @Max(MAX_ROOMS, { message: `bedroomsMax tối đa ${MAX_ROOMS}` })
  bedroomsMax?: number;

  /** Số phòng tắm ít nhất (gồm cả mốc này). */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'bathroomsMin phải là số nguyên' })
  @Min(0, { message: 'bathroomsMin không được âm' })
  @Max(MAX_ROOMS, { message: `bathroomsMin tối đa ${MAX_ROOMS}` })
  bathroomsMin?: number;

  /** Số phòng tắm nhiều nhất (gồm cả mốc này) Phải ≥ bathroomsMin. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'bathroomsMax phải là số nguyên' })
  @Min(0, { message: 'bathroomsMax không được âm' })
  @Max(MAX_ROOMS, { message: `bathroomsMax tối đa ${MAX_ROOMS}` })
  bathroomsMax?: number;
}
