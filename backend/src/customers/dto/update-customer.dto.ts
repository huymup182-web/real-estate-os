import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { NoHtml } from '../../common/validation/no-html.decorator.js';
import {
  CUSTOMER_PURPOSES,
  CUSTOMER_SOURCES,
  PHONE_MESSAGE,
  PHONE_PATTERN,
  PURCHASE_TIMELINES,
} from '../customer-values.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Trường tuỳ chọn: chuỗi rỗng sau khi trim nghĩa là xoá giá trị (như gửi null). */
const trimToNull = ({ value }: { value: unknown }): unknown => {
  const trimmed = trim({ value });
  return trimmed === '' ? null : trimmed;
};

/** Trường bắt buộc: không gửi = giữ nguyên; gửi thì không được null. */
const sent = (_dto: unknown, value: unknown): boolean => value !== undefined;

const oneOf = (values: readonly string[]): string => values.join(', ');

/**
 * Sửa khách hàng (TASK-077), PATCH: chỉ đổi trường được gửi; trường tuỳ chọn gửi `null` để xoá.
 * Không sửa ở đây: môi giới phụ trách (TASK-079), trạng thái và lý do mất khách (TASK-082).
 */
export class UpdateCustomerDto {
  /** Chống ghi đè: `updatedAt` client đang có; khác bản ghi hiện tại → 409. */
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'expectedUpdatedAt phải là thời điểm ISO 8601' })
  expectedUpdatedAt?: Date;

  @ValidateIf(sent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'fullName không được để trống' })
  @MaxLength(255)
  @NoHtml()
  fullName?: string;

  @ValidateIf(sent)
  @Transform(trim)
  @IsString()
  @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  phone?: string;

  @Transform(trimToNull)
  @IsOptional()
  @IsEmail({}, { message: 'email không hợp lệ' })
  @MaxLength(255)
  email?: string | null;

  @IsOptional()
  @IsIn(CUSTOMER_PURPOSES, { message: `purpose phải là một trong: ${oneOf(CUSTOMER_PURPOSES)}` })
  purpose?: string | null;

  @IsOptional()
  @IsIn(PURCHASE_TIMELINES, {
    message: `purchaseTimeline phải là một trong: ${oneOf(PURCHASE_TIMELINES)}`,
  })
  purchaseTimeline?: string | null;

  @IsOptional()
  @IsIn(CUSTOMER_SOURCES, { message: `source phải là một trong: ${oneOf(CUSTOMER_SOURCES)}` })
  source?: string | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  @NoHtml()
  notes?: string | null;
}

/** Các trường sửa được (mọi trường của DTO trừ expectedUpdatedAt). */
export const EDITABLE_CUSTOMER_FIELDS = [
  'fullName',
  'phone',
  'email',
  'purpose',
  'purchaseTimeline',
  'source',
  'notes',
] as const satisfies readonly (keyof UpdateCustomerDto)[];
