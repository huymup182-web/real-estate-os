import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
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

/** Chuỗi rỗng sau khi trim coi như không gửi. */
const trimToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = trim({ value });
  return trimmed === '' ? undefined : trimmed;
};

const oneOf = (values: readonly string[]): string => values.join(', ');

/**
 * Tạo khách hàng (TASK-077). Không nhận: tenantId, môi giới phụ trách, trạng thái, lý do mất khách:
 * backend tự gán (người tạo phụ trách, trạng thái NEW) hoặc làm ở task sau (TASK-079 phân khách,
 * TASK-082 pipeline). Số điện thoại không bắt buộc duy nhất (docs/database.md mục 4.5).
 */
export class CreateCustomerDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'fullName không được để trống' })
  @MaxLength(255)
  @NoHtml()
  fullName!: string;

  @Transform(trim)
  @IsString()
  @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  phone!: string;

  @Transform(trimToUndefined)
  @IsOptional()
  @IsEmail({}, { message: 'email không hợp lệ' })
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsIn(CUSTOMER_PURPOSES, { message: `purpose phải là một trong: ${oneOf(CUSTOMER_PURPOSES)}` })
  purpose?: string;

  @IsOptional()
  @IsIn(PURCHASE_TIMELINES, {
    message: `purchaseTimeline phải là một trong: ${oneOf(PURCHASE_TIMELINES)}`,
  })
  purchaseTimeline?: string;

  @IsOptional()
  @IsIn(CUSTOMER_SOURCES, { message: `source phải là một trong: ${oneOf(CUSTOMER_SOURCES)}` })
  source?: string;

  @Transform(trimToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  @NoHtml()
  notes?: string;
}
