import { IsIn, IsOptional } from 'class-validator';

import { LISTING_STYLES, type ListingStyle } from '../listing-writer.tool.js';

/** Kiểu tin AI viết (TASK-136); bỏ trống là `PROFESSIONAL`. */
export class AiListingDto {
  @IsOptional()
  @IsIn(LISTING_STYLES, { message: `style phải là một trong: ${LISTING_STYLES.join(', ')}` })
  style?: ListingStyle;
}
