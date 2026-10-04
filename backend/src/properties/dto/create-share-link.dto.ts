import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { MAX_SHARE_LINK_DAYS } from '../property-share-links.values.js';

/** Tạo link chia sẻ BĐS cho khách (TASK-061). */
export class CreateShareLinkDto {
  /** Số ngày link còn dùng được; bỏ trống = 30 ngày. */
  @IsOptional()
  @IsInt({ message: 'expiresInDays phải là số nguyên' })
  @Min(1, { message: `expiresInDays phải từ 1 đến ${MAX_SHARE_LINK_DAYS}` })
  @Max(MAX_SHARE_LINK_DAYS, { message: `expiresInDays phải từ 1 đến ${MAX_SHARE_LINK_DAYS}` })
  expiresInDays?: number;
}
