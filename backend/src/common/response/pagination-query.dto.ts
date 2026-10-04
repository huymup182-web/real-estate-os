import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Tham số phân trang offset `?page=1&pageSize=20` (tối đa 100). DTO danh sách kế thừa class này
 * rồi thêm tham số lọc riêng.
 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;

  /** Số bản ghi bỏ qua, dùng cho `skip`/`offset` khi truy vấn. */
  get offset(): number {
    return (this.page - 1) * this.pageSize;
  }
}
