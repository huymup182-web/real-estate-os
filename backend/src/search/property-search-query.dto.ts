import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../common/response/pagination-query.dto.js';
import { MAX_KEYWORD_LENGTH } from './keyword.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Tham số tìm kiếm BĐS trên `GET /properties` (Phase 5, phase0/05-API-CONVENTIONS.md mục 5). Các bộ lọc
 * giá, diện tích, khu vực… thêm vào class này ở TASK-065..072 để saved search dùng chung một schema.
 */
export class PropertySearchQueryDto extends PaginationQueryDto {
  /** Từ khoá: tìm trong tiêu đề, mô tả, địa chỉ (có dấu hay không dấu), hoặc đúng mã BĐS. */
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'q phải là chuỗi' })
  @MaxLength(MAX_KEYWORD_LENGTH, { message: `q tối đa ${MAX_KEYWORD_LENGTH} ký tự` })
  q?: string;
}
