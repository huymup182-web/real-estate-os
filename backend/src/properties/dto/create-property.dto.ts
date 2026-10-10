import { Transform } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { NoHtml } from '../../common/validation/no-html.decorator.js';
import {
  COMMISSION_TYPES,
  DIRECTIONS,
  LEGAL_STATUSES,
  PROPERTY_SOURCES,
  PROPERTY_TYPES,
  ROAD_ACCESSES,
} from '../property-values.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Chuỗi rỗng sau khi trim coi như không gửi. */
const trimToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = trim({ value });
  return trimmed === '' ? undefined : trimmed;
};

/** Trường đi theo cặp: một trong hai có giá trị thì bắt buộc cả hai. */
const present = (value: unknown): boolean => value !== undefined && value !== null;

const SMALLINT_MAX = 32_767;
const oneOf = (values: readonly string[]): string => values.join(', ');

/**
 * Tạo BĐS (TASK-049). Giới hạn số theo kiểu cột trong database (docs/database.md mục 4.4).
 * Không nhận: tenantId, mã BĐS, trạng thái, môi giới phụ trách, chủ nhà, xác minh: backend tự gán
 * hoặc làm ở các task sau (TASK-054 trạng thái, TASK-055 chủ nhà, TASK-056 phân môi giới).
 * transactionType không nhận: MVP chỉ bán (SALE, mặc định trong database).
 */
export class CreatePropertyDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'title không được để trống' })
  @MaxLength(255)
  @NoHtml()
  title!: string;

  @Transform(trimToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  @NoHtml()
  description?: string;

  @IsIn(PROPERTY_TYPES, { message: `propertyType phải là một trong: ${oneOf(PROPERTY_TYPES)}` })
  propertyType!: string;

  /** Giá bán, đơn vị đồng. */
  @IsInt({ message: 'price phải là số nguyên (đồng)' })
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  price!: number;

  /** Diện tích, m², tối đa 2 chữ số thập phân. */
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(9_999_999_999.99)
  area!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(SMALLINT_MAX)
  bedrooms?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(SMALLINT_MAX)
  bathrooms?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(SMALLINT_MAX)
  floors?: number;

  @IsOptional()
  @IsIn(DIRECTIONS, { message: `direction phải là một trong: ${oneOf(DIRECTIONS)}` })
  direction?: string;

  /** Lộ giới / độ rộng hẻm, mét. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(9_999.99)
  roadWidth?: number;

  @IsOptional()
  @IsIn(ROAD_ACCESSES, { message: `roadAccess phải là một trong: ${oneOf(ROAD_ACCESSES)}` })
  roadAccess?: string;

  @IsOptional()
  @IsIn(LEGAL_STATUSES, { message: `legalStatus phải là một trong: ${oneOf(LEGAL_STATUSES)}` })
  legalStatus?: string;

  @IsUUID('all', { message: 'provinceId phải là UUID' })
  provinceId!: string;

  @IsOptional()
  @IsUUID('all', { message: 'districtId phải là UUID' })
  districtId?: string;

  @IsUUID('all', { message: 'wardId phải là UUID' })
  wardId!: string;

  @Transform(trimToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @NoHtml()
  streetAddress?: string;

  /** Toạ độ: gửi cả hai hoặc không gửi. */
  @ValidateIf((dto: CreatePropertyDto) => present(dto.latitude) || present(dto.longitude))
  @IsDefined({ message: 'latitude và longitude phải gửi cùng nhau' })
  @IsNumber({ maxDecimalPlaces: 6, allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ValidateIf((dto: CreatePropertyDto) => present(dto.latitude) || present(dto.longitude))
  @IsDefined({ message: 'latitude và longitude phải gửi cùng nhau' })
  @IsNumber({ maxDecimalPlaces: 6, allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsIn(PROPERTY_SOURCES, { message: `source phải là một trong: ${oneOf(PROPERTY_SOURCES)}` })
  source?: string;

  /** Hoa hồng: gửi cả loại và giá trị, hoặc không gửi. PERCENT thì giá trị ≤ 100. */
  @ValidateIf(
    (dto: CreatePropertyDto) => present(dto.commissionType) || present(dto.commissionValue),
  )
  @IsDefined({ message: 'commissionType và commissionValue phải gửi cùng nhau' })
  @IsIn(COMMISSION_TYPES, {
    message: `commissionType phải là một trong: ${oneOf(COMMISSION_TYPES)}`,
  })
  commissionType?: string;

  @ValidateIf(
    (dto: CreatePropertyDto) => present(dto.commissionType) || present(dto.commissionValue),
  )
  @IsDefined({ message: 'commissionType và commissionValue phải gửi cùng nhau' })
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(999_999_999_999.99)
  commissionValue?: number;
}
