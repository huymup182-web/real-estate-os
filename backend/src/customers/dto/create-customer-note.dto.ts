import { Transform, Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { NoHtml } from '../../common/validation/no-html.decorator.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Thêm ghi chú cho khách (TASK-080). */
export class CreateCustomerNoteDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'content không được để trống' })
  @MaxLength(5000)
  @NoHtml()
  content!: string;

  /** Thời điểm việc được ghi chú xảy ra (vd cuộc gặp hôm qua); mặc định là lúc ghi. Không được ở tương lai. */
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'occurredAt phải là thời điểm ISO 8601' })
  occurredAt?: Date;
}
