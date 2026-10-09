import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { MAX_MATCH_LIMIT } from '../matching.service.js';

/** `?minScore&limit` của API matching (TASK-090). */
export class MatchQueryDto {
  /** Điểm tối thiểu 0..100, mặc định 50. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'minScore phải là số nguyên' })
  @Min(0, { message: 'minScore từ 0 đến 100' })
  @Max(100, { message: 'minScore từ 0 đến 100' })
  minScore?: number;

  /** Số kết quả tối đa 1..100, mặc định 20. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit phải là số nguyên' })
  @Min(1, { message: `limit từ 1 đến ${MAX_MATCH_LIMIT}` })
  @Max(MAX_MATCH_LIMIT, { message: `limit từ 1 đến ${MAX_MATCH_LIMIT}` })
  limit?: number;
}
