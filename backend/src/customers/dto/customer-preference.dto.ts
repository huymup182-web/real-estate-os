import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

import {
  DIRECTIONS,
  LEGAL_STATUSES,
  PROPERTY_TYPES,
  ROAD_ACCESSES,
} from '../../properties/property-values.js';
import { TRANSACTION_TYPES } from '../customer-values.js';

/** Số khu vực tối đa mỗi loại (tỉnh, quận/huyện, phường/xã) trong một nhu cầu. */
export const MAX_AREAS = 50;
const MAX_AREA_M2 = 9_999_999_999.99;
const SMALLINT_MAX = 32_767;
const AREA_NUMBER = { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false };
const oneOf = (values: readonly string[]): string => values.join(', ');

/** Mảng: bỏ phần tử trùng; mảng rỗng nghĩa là không đặt tiêu chí này (null). Giá trị khác để validator báo lỗi. */
const uniqueList = ({ value }: { value: unknown }): unknown => {
  if (!Array.isArray(value)) {
    return value;
  }
  return value.length === 0 ? null : [...new Set(value)];
};

/** Trường bắt buộc khi sửa: không gửi = giữ nguyên; gửi thì không được null. */
const sent = (_dto: unknown, value: unknown): boolean => value !== undefined;

/**
 * Nhu cầu của khách (TASK-078). Mọi tiêu chí đều tuỳ chọn; gửi `null` (khi sửa) hoặc mảng rỗng để bỏ
 * tiêu chí. Danh sách giá trị lấy đúng danh sách của BĐS để matching so được (docs/database.md mục 4.5).
 * Luật min ≤ max và "có ít nhất một tiêu chí" kiểm ở service trên giá trị sau khi gộp.
 */
export class CustomerPreferenceFieldsDto {
  @IsOptional()
  @IsArray({ message: 'propertyTypes phải là mảng' })
  @Transform(uniqueList)
  @IsIn(PROPERTY_TYPES, {
    each: true,
    message: `propertyTypes chỉ gồm: ${oneOf(PROPERTY_TYPES)}`,
  })
  propertyTypes?: string[] | null;

  /** Ngân sách, đồng. */
  @IsOptional()
  @IsInt({ message: 'budgetMin phải là số nguyên (đồng)' })
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  budgetMin?: number | null;

  @IsOptional()
  @IsInt({ message: 'budgetMax phải là số nguyên (đồng)' })
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  budgetMax?: number | null;

  /** Diện tích, m². */
  @IsOptional()
  @IsNumber(AREA_NUMBER)
  @Min(0)
  @Max(MAX_AREA_M2)
  areaMin?: number | null;

  @IsOptional()
  @IsNumber(AREA_NUMBER)
  @Min(0)
  @Max(MAX_AREA_M2)
  areaMax?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(SMALLINT_MAX)
  bedroomsMin?: number | null;

  @IsOptional()
  @IsArray({ message: 'provinceIds phải là mảng' })
  @Transform(uniqueList)
  @ArrayMaxSize(MAX_AREAS)
  @IsUUID('all', { each: true, message: 'provinceIds chỉ gồm UUID' })
  provinceIds?: string[] | null;

  @IsOptional()
  @IsArray({ message: 'districtIds phải là mảng' })
  @Transform(uniqueList)
  @ArrayMaxSize(MAX_AREAS)
  @IsUUID('all', { each: true, message: 'districtIds chỉ gồm UUID' })
  districtIds?: string[] | null;

  @IsOptional()
  @IsArray({ message: 'wardIds phải là mảng' })
  @Transform(uniqueList)
  @ArrayMaxSize(MAX_AREAS)
  @IsUUID('all', { each: true, message: 'wardIds chỉ gồm UUID' })
  wardIds?: string[] | null;

  @IsOptional()
  @IsArray({ message: 'directions phải là mảng' })
  @Transform(uniqueList)
  @IsIn(DIRECTIONS, { each: true, message: `directions chỉ gồm: ${oneOf(DIRECTIONS)}` })
  directions?: string[] | null;

  @IsOptional()
  @IsArray({ message: 'legalStatuses phải là mảng' })
  @Transform(uniqueList)
  @IsIn(LEGAL_STATUSES, {
    each: true,
    message: `legalStatuses chỉ gồm: ${oneOf(LEGAL_STATUSES)}`,
  })
  legalStatuses?: string[] | null;

  /** Đường vào tối thiểu khách chấp nhận. */
  @IsOptional()
  @IsIn(ROAD_ACCESSES, { message: `minRoadAccess phải là một trong: ${oneOf(ROAD_ACCESSES)}` })
  minRoadAccess?: string | null;
}

/** `POST /customers/:id/preferences`. */
export class CreateCustomerPreferenceDto extends CustomerPreferenceFieldsDto {
  @IsOptional()
  @IsIn(TRANSACTION_TYPES, {
    message: `transactionType phải là một trong: ${oneOf(TRANSACTION_TYPES)}`,
  })
  transactionType?: string;

  @IsOptional()
  @IsBoolean({ message: 'isActive phải là true hoặc false' })
  isActive?: boolean;
}

/** `PATCH /customers/:id/preferences/:preferenceId`: chỉ đổi trường được gửi. */
export class UpdateCustomerPreferenceDto extends CustomerPreferenceFieldsDto {
  /** Chống ghi đè: `updatedAt` client đang có; khác bản ghi hiện tại → 409. */
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'expectedUpdatedAt phải là thời điểm ISO 8601' })
  expectedUpdatedAt?: Date;

  @ValidateIf(sent)
  @IsIn(TRANSACTION_TYPES, {
    message: `transactionType phải là một trong: ${oneOf(TRANSACTION_TYPES)}`,
  })
  transactionType?: string;

  @ValidateIf(sent)
  @IsBoolean({ message: 'isActive phải là true hoặc false' })
  isActive?: boolean;
}

/** Tiêu chí của nhu cầu (cần ít nhất một). */
export const PREFERENCE_CRITERIA = [
  'propertyTypes',
  'budgetMin',
  'budgetMax',
  'areaMin',
  'areaMax',
  'bedroomsMin',
  'provinceIds',
  'districtIds',
  'wardIds',
  'directions',
  'legalStatuses',
  'minRoadAccess',
] as const satisfies readonly (keyof CustomerPreferenceFieldsDto)[];

/** Các trường sửa được. */
export const EDITABLE_PREFERENCE_FIELDS = [
  'transactionType',
  'isActive',
  ...PREFERENCE_CRITERIA,
] as const satisfies readonly (keyof UpdateCustomerPreferenceDto)[];
