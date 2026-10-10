import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

import { NoHtml } from '../../common/validation/no-html.decorator.js';
import { SAVED_SEARCH_NAME_MAX } from '../saved-searches.values.js';
import { trim } from './create-saved-search.dto.js';

/** Sửa tìm kiếm đã lưu (TASK-075): chỉ đổi trường được gửi; `filters` gửi lên thay toàn bộ bộ lọc cũ. */
export class UpdateSavedSearchDto {
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'name phải là chuỗi' })
  @IsNotEmpty({ message: 'name không được để trống' })
  @MaxLength(SAVED_SEARCH_NAME_MAX, { message: `name tối đa ${SAVED_SEARCH_NAME_MAX} ký tự` })
  @NoHtml()
  name?: string;

  @IsOptional()
  @IsObject({ message: 'filters phải là object bộ lọc tìm kiếm' })
  filters?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean({ message: 'notify phải là true hoặc false' })
  notify?: boolean;
}
