import { Transform } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../common/response/pagination-query.dto.js';
import { CUSTOMER_STATUSES } from '../customer-values.js';

/** Danh sách trong query: `?status=A,B` hoặc `?status=A&status=B` → `['A', 'B']`. */
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

/**
 * `GET /customers?q&status=NEW,CONTACTED&page&pageSize`: lọc theo bước pipeline (TASK-082) và tìm theo tên,
 * số điện thoại, email (TASK-108).
 */
export class CustomerListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'q phải là chuỗi' })
  @MaxLength(100, { message: 'q tối đa 100 ký tự' })
  q?: string;

  @IsOptional()
  @Transform(commaList)
  @IsArray()
  @ArrayNotEmpty({ message: 'status không được để trống' })
  @IsIn(CUSTOMER_STATUSES, {
    each: true,
    message: `status chỉ gồm: ${CUSTOMER_STATUSES.join(', ')}`,
  })
  status?: string[];
}
