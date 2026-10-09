import { Type } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';

/** `GET /reports/dashboard?from&to`: kỳ thống kê, mặc định 30 ngày gần nhất (TASK-102). */
export class DashboardQueryDto {
  /** Từ thời điểm (gồm). */
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'from phải là thời điểm ISO 8601' })
  from?: Date;

  /** Đến trước thời điểm (không gồm); mặc định bây giờ. */
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'to phải là thời điểm ISO 8601' })
  to?: Date;
}
