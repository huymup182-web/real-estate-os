import { Type } from 'class-transformer';
import { IsDate, IsIn, IsOptional } from 'class-validator';

import { USER_SETTABLE_STATUSES } from '../property-values.js';

/** Đổi trạng thái BĐS (TASK-054). */
export class ChangePropertyStatusDto {
  @IsIn(USER_SETTABLE_STATUSES, {
    message: `status phải là một trong: ${USER_SETTABLE_STATUSES.join(', ')}`,
  })
  status!: (typeof USER_SETTABLE_STATUSES)[number];

  /** Chống ghi đè như khi sửa BĐS: khác `updatedAt` hiện tại → 409. */
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'expectedUpdatedAt phải là thời điểm ISO 8601' })
  expectedUpdatedAt?: Date;
}
