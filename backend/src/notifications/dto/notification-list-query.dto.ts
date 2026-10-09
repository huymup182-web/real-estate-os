import { Transform } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsOptional } from 'class-validator';

import { PaginationQueryDto } from '../../common/response/pagination-query.dto.js';
import { NOTIFICATION_TYPES } from '../notification-values.js';

/** Danh sách trong query: `?type=A,B` hoặc `?type=A&type=B` → `['A', 'B']`. */
const commaList = ({ value }: { value: unknown }): unknown => {
  const parts = Array.isArray(value) ? value : [value];
  if (!parts.every((part) => typeof part === 'string')) {
    return value;
  }
  return [
    ...new Set(
      (parts as string[])
        .flatMap((part) => part.split(','))
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    ),
  ];
};

/** `true`/`false` trong query thành boolean; giá trị khác giữ nguyên để báo lỗi. */
const queryBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

/** `GET /notifications?unread=true&type=NEW_PROPERTY,MATCHED_PROPERTY&page&pageSize` (TASK-099). */
export class NotificationListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean({ message: 'unread phải là true hoặc false' })
  unread?: boolean;

  @IsOptional()
  @Transform(commaList)
  @IsArray()
  @ArrayNotEmpty({ message: 'type không được để trống' })
  @IsIn(NOTIFICATION_TYPES, {
    each: true,
    message: `type chỉ gồm: ${NOTIFICATION_TYPES.join(', ')}`,
  })
  type?: string[];
}
