import { Transform, Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { PaginationQueryDto } from '../common/response/pagination-query.dto.js';
import { MAX_KEYWORD_LENGTH } from './keyword.js';

/** Diện tích lớn nhất cột `properties.area` nhận (numeric(12, 2)). */
const MAX_AREA = 9_999_999_999.99;
const AREA_NUMBER = { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false };

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

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
}
