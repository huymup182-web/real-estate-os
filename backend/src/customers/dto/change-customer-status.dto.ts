import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { NoHtml } from '../../common/validation/no-html.decorator.js';
import { CUSTOMER_STATUSES, type CustomerStatus } from '../customer-values.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Chuyển khách sang bước pipeline khác (TASK-082). Sang LOST bắt buộc `lostReason`. */
export class ChangeCustomerStatusDto {
  @IsIn(CUSTOMER_STATUSES, {
    message: `status phải là một trong: ${CUSTOMER_STATUSES.join(', ')}`,
  })
  status!: CustomerStatus;

  /** Lý do mất khách: bắt buộc khi sang LOST; gửi kèm bước khác → 400 (kiểm ở service). */
  @ValidateIf(
    (dto: ChangeCustomerStatusDto) => dto.status === 'LOST' || dto.lostReason !== undefined,
  )
  @Transform(trim)
  @IsString({ message: 'lostReason là chuỗi, bắt buộc khi chuyển sang LOST' })
  @IsNotEmpty({ message: 'lostReason không được để trống' })
  @MaxLength(1000)
  @NoHtml()
  lostReason?: string;

  /** Chống ghi đè như khi sửa khách: khác `updatedAt` hiện tại → 409. */
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'expectedUpdatedAt phải là thời điểm ISO 8601' })
  expectedUpdatedAt?: Date;
}
