import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

import { NoHtml } from '../../common/validation/no-html.decorator.js';
import { SAVED_SEARCH_NAME_MAX } from '../saved-searches.values.js';

export const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Lưu một tìm kiếm (TASK-075). `filters` là object cùng tham số với `GET /properties` (q, priceMin,
 * propertyType…, sort), không gồm `page`/`pageSize`; service kiểm chi tiết bằng đúng schema đó.
 */
export class CreateSavedSearchDto {
  @Transform(trim)
  @IsString({ message: 'name phải là chuỗi' })
  @IsNotEmpty({ message: 'name không được để trống' })
  @MaxLength(SAVED_SEARCH_NAME_MAX, { message: `name tối đa ${SAVED_SEARCH_NAME_MAX} ký tự` })
  @NoHtml()
  name!: string;

  @IsObject({ message: 'filters phải là object bộ lọc tìm kiếm' })
  filters!: Record<string, unknown>;

  /** Báo khi có BĐS mới khớp (gửi thông báo làm ở Phase 8); bỏ trống = bật. */
  @IsOptional()
  @IsBoolean({ message: 'notify phải là true hoặc false' })
  notify?: boolean;
}
