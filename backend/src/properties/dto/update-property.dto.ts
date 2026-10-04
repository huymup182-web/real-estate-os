import { Transform, Type } from 'class-transformer';
import {
  IsDate,
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

/** Trường tuỳ chọn: chuỗi rỗng sau khi trim nghĩa là xoá giá trị (như gửi null). */
const trimToNull = ({ value }: { value: unknown }): unknown => {
  const trimmed = trim({ value });
  return trimmed === '' ? null : trimmed;
};

/** Trường bắt buộc của BĐS: không gửi = giữ nguyên; gửi thì không được null. */
const sent = (_dto: unknown, value: unknown): boolean => value !== undefined;

const SMALLINT_MAX = 32_767;
const oneOf = (values: readonly string[]): string => values.join(', ');

/**
 * Sửa BĐS (TASK-052), PATCH: chỉ đổi trường được gửi. Trường tuỳ chọn gửi `null` để xoá.
 * Cùng giới hạn với CreatePropertyDto. Các luật theo cặp (toạ độ, hoa hồng) và địa giới được kiểm trên
 * giá trị sau khi gộp với bản ghi hiện tại (ở service).
 * Không sửa ở đây: mã, trạng thái, môi giới, chủ nhà, xác minh (task riêng).
 */
export class UpdatePropertyDto {
  /** Chống ghi đè: `updatedAt` client đang có; khác bản ghi hiện tại → 409. */
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'expectedUpdatedAt phải là thời điểm ISO 8601' })
  expectedUpdatedAt?: Date;

  @ValidateIf(sent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'title không được để trống' })
  @MaxLength(255)
  @NoHtml()
  title?: string;

  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  @NoHtml()
  description?: string | null;

  @ValidateIf(sent)
  @IsIn(PROPERTY_TYPES, { message: `propertyType phải là một trong: ${oneOf(PROPERTY_TYPES)}` })
  propertyType?: string;

  @ValidateIf(sent)
  @IsInt({ message: 'price phải là số nguyên (đồng)' })
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  price?: number;

  @ValidateIf(sent)
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(9_999_999_999.99)
  area?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(SMALLINT_MAX)
  bedrooms?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(SMALLINT_MAX)
  bathrooms?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(SMALLINT_MAX)
  floors?: number | null;

  @IsOptional()
  @IsIn(DIRECTIONS, { message: `direction phải là một trong: ${oneOf(DIRECTIONS)}` })
  direction?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(9_999.99)
  roadWidth?: number | null;

  @IsOptional()
  @IsIn(ROAD_ACCESSES, { message: `roadAccess phải là một trong: ${oneOf(ROAD_ACCESSES)}` })
  roadAccess?: string | null;

  @IsOptional()
  @IsIn(LEGAL_STATUSES, { message: `legalStatus phải là một trong: ${oneOf(LEGAL_STATUSES)}` })
  legalStatus?: string | null;

  @ValidateIf(sent)
  @IsUUID('all', { message: 'provinceId phải là UUID' })
  provinceId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'districtId phải là UUID' })
  districtId?: string | null;

  @ValidateIf(sent)
  @IsUUID('all', { message: 'wardId phải là UUID' })
  wardId?: string;

  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @NoHtml()
  streetAddress?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6, allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6, allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude?: number | null;

  @IsOptional()
  @IsIn(PROPERTY_SOURCES, { message: `source phải là một trong: ${oneOf(PROPERTY_SOURCES)}` })
  source?: string | null;

  @IsOptional()
  @IsIn(COMMISSION_TYPES, {
    message: `commissionType phải là một trong: ${oneOf(COMMISSION_TYPES)}`,
  })
  commissionType?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(999_999_999_999.99)
  commissionValue?: number | null;
}

/** Các trường dữ liệu BĐS sửa được (mọi trường của DTO trừ expectedUpdatedAt). */
export const EDITABLE_PROPERTY_FIELDS = [
  'title',
  'description',
  'propertyType',
  'price',
  'area',
  'bedrooms',
  'bathrooms',
  'floors',
  'direction',
  'roadWidth',
  'roadAccess',
  'legalStatus',
  'provinceId',
  'districtId',
  'wardId',
  'streetAddress',
  'latitude',
  'longitude',
  'source',
  'commissionType',
  'commissionValue',
] as const satisfies readonly (keyof UpdatePropertyDto)[];
