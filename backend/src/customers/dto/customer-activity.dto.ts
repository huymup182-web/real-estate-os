import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsDate,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { PaginationQueryDto } from '../../common/response/pagination-query.dto.js';
import { NoHtml } from '../../common/validation/no-html.decorator.js';
import {
  ACTIVITY_TYPES,
  MAX_ACTIVITY_PROPERTIES,
  USER_ACTIVITY_TYPES,
} from '../customer-values.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Chuỗi rỗng sau khi trim coi như không gửi. */
const trimToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = trim({ value });
  return trimmed === '' ? undefined : trimmed;
};

/** Mảng: bỏ phần tử trùng. */
const unique = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value) ? [...new Set(value)] : value;

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

const oneOf = (values: readonly string[]): string => values.join(', ');

/** Thời điểm việc xảy ra (mặc định lúc ghi); service kiểm không ở tương lai. */
class OccurredAtDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'occurredAt phải là thời điểm ISO 8601' })
  occurredAt?: Date;
}

/** Thêm ghi chú (TASK-080): hoạt động NOTE, bắt buộc nội dung. */
export class CreateCustomerNoteDto extends OccurredAtDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'content không được để trống' })
  @MaxLength(5000)
  @NoHtml()
  content!: string;
}

/**
 * Ghi một hoạt động lên timeline khách (TASK-081). Chỉ các loại người dùng tự ghi (USER_ACTIVITY_TYPES).
 * NOTE bắt buộc `content`; PROPERTY_SENT bắt buộc `propertyIds`. BĐS phải là BĐS người ghi xem được.
 */
export class CreateCustomerActivityDto extends OccurredAtDto {
  @IsIn(USER_ACTIVITY_TYPES, {
    message: `type phải là một trong: ${oneOf(USER_ACTIVITY_TYPES)}`,
  })
  type!: string;

  @ValidateIf((dto: CreateCustomerActivityDto) => dto.type === 'NOTE' || dto.content !== undefined)
  @Transform(trimToUndefined)
  @IsString({ message: 'content là chuỗi, bắt buộc với ghi chú (NOTE)' })
  @IsNotEmpty({ message: 'content không được để trống' })
  @MaxLength(5000)
  @NoHtml()
  content?: string;

  @ValidateIf(
    (dto: CreateCustomerActivityDto) =>
      dto.type === 'PROPERTY_SENT' || dto.propertyIds !== undefined,
  )
  @IsArray({ message: 'propertyIds phải là mảng, bắt buộc khi gửi BĐS (PROPERTY_SENT)' })
  @Transform(unique)
  @ArrayNotEmpty({ message: 'propertyIds không được rỗng' })
  @ArrayMaxSize(MAX_ACTIVITY_PROPERTIES)
  @IsUUID('all', { each: true, message: 'propertyIds chỉ gồm UUID' })
  propertyIds?: string[];
}

/** `GET /customers/:id/activities?type=CALL,NOTE&page&pageSize`. */
export class CustomerActivityQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(commaList)
  @IsArray()
  @ArrayNotEmpty({ message: 'type không được để trống' })
  @IsIn(ACTIVITY_TYPES, { each: true, message: `type chỉ gồm: ${oneOf(ACTIVITY_TYPES)}` })
  type?: string[];
}
