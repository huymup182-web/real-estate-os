import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

import { PROPERTY_TYPES } from '../../properties/property-values.js';

/** Cách chia nhóm thống kê giá thị trường. */
export const MARKET_GROUP_BY = ['ward', 'propertyType'] as const;
export type MarketGroupBy = (typeof MARKET_GROUP_BY)[number];

export const MARKET_DEFAULT_MONTHS = 12;
export const MARKET_MAX_MONTHS = 36;

/** `GET /reports/market/prices?provinceId&wardId&propertyType&groupBy&months` (TASK-145). */
export class MarketPriceQueryDto {
  @IsOptional()
  @IsUUID('all', { message: 'provinceId phải là UUID' })
  provinceId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'wardId phải là UUID' })
  wardId?: string;

  @IsOptional()
  @IsIn(PROPERTY_TYPES, { message: `propertyType phải là một trong: ${PROPERTY_TYPES.join(', ')}` })
  propertyType?: string;

  /** Chia nhóm theo phường/xã (mặc định) hoặc loại BĐS. */
  @IsOptional()
  @IsIn(MARKET_GROUP_BY, { message: `groupBy phải là một trong: ${MARKET_GROUP_BY.join(', ')}` })
  groupBy?: MarketGroupBy;

  /** Tính tin đăng trong chừng này tháng gần nhất, mặc định 12. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'months phải là số nguyên' })
  @Min(1, { message: `months từ 1 đến ${MARKET_MAX_MONTHS}` })
  @Max(MARKET_MAX_MONTHS, { message: `months từ 1 đến ${MARKET_MAX_MONTHS}` })
  months?: number;
}
