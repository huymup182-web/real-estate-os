import { Type } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';

/** Xác minh lại BĐS (TASK-062). */
export class VerifyPropertyDto {
  /** Chống ghi đè như khi sửa BĐS: khác `updatedAt` hiện tại → 409. */
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'expectedUpdatedAt phải là thời điểm ISO 8601' })
  expectedUpdatedAt?: Date;
}
