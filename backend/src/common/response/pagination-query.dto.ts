import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
/**
 * Trang lớn nhất (TASK-074): chặn số trang khổng lồ (vd `page=1e20`) làm OFFSET vượt giới hạn và lỗi 500.
 * Với pageSize 100 là 1.000.000 bản ghi, thừa cho danh sách xem tay; cần duyệt hết thì lọc hẹp lại.
 */
export const MAX_PAGE = 10_000;

/**
 * Tham số phân trang offset `?page=1&pageSize=20` (pageSize tối đa 100, page tối đa 10.000). DTO danh sách kế thừa class này
 * rồi thêm tham số lọc riêng.
 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page phải là số nguyên' })
  @Min(1, { message: 'page nhỏ nhất là 1' })
  @Max(MAX_PAGE, { message: `page lớn nhất là ${MAX_PAGE}` })
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'pageSize phải là số nguyên' })
  @Min(1, { message: 'pageSize nhỏ nhất là 1' })
  @Max(MAX_PAGE_SIZE, { message: `pageSize lớn nhất là ${MAX_PAGE_SIZE}` })
  pageSize: number = DEFAULT_PAGE_SIZE;

  /** Số bản ghi bỏ qua, dùng cho `skip`/`offset` khi truy vấn. */
  get offset(): number {
    return (this.page - 1) * this.pageSize;
  }
}
