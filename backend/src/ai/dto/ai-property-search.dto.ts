import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export const AI_SEARCH_QUERY_MAX = 500;

/** Câu tìm BĐS người dùng gõ (TASK-134), vd "nhà khoảng 5 tỷ ở Nha Trang, 3 phòng ngủ, ô tô vào được". */
export class AiPropertySearchDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  @IsString({ message: 'query phải là chuỗi' })
  @MinLength(2, { message: 'query cần ít nhất 2 ký tự' })
  @MaxLength(AI_SEARCH_QUERY_MAX, { message: `query tối đa ${AI_SEARCH_QUERY_MAX} ký tự` })
  query!: string;
}
