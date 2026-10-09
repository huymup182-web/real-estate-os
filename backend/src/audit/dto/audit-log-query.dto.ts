import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsUUID, Matches } from 'class-validator';

import { PaginationQueryDto } from '../../common/response/pagination-query.dto.js';

/** `GET /audit-logs?entityType&entityId&userId&action&from&to&page&pageSize` (TASK-112). */
export class AuditLogQueryDto extends PaginationQueryDto {
  /** Loại đối tượng, vd `property`, `customer`. */
  @IsOptional()
  @Matches(/^[a-z][a-z_]{0,49}$/, { message: 'entityType chỉ gồm chữ thường và dấu gạch dưới' })
  entityType?: string;

  @IsOptional()
  @IsUUID('all', { message: 'entityId phải là UUID' })
  entityId?: string;

  /** Người thao tác. */
  @IsOptional()
  @IsUUID('all', { message: 'userId phải là UUID' })
  userId?: string;

  /** Đúng một thao tác, vd `property.update`. */
  @IsOptional()
  @Matches(/^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/, { message: 'action có dạng module.hanh_dong' })
  action?: string;

  /** Từ thời điểm (gồm). */
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'from phải là thời điểm ISO 8601' })
  from?: Date;

  /** Đến trước thời điểm (không gồm). */
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'to phải là thời điểm ISO 8601' })
  to?: Date;
}
