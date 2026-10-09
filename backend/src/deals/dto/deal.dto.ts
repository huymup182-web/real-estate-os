import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { PaginationQueryDto } from '../../common/response/pagination-query.dto.js';
import { NoHtml } from '../../common/validation/no-html.decorator.js';
import { DEAL_STAGES, type DealStage, MAX_AMOUNT } from '../deal-values.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Chuỗi rỗng sau khi trim coi như không gửi (tạo) hoặc xoá giá trị (sửa). */
const trimToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = trim({ value });
  return trimmed === '' ? undefined : trimmed;
};
const trimToNull = ({ value }: { value: unknown }): unknown => {
  const trimmed = trim({ value });
  return trimmed === '' ? null : trimmed;
};

/** Danh sách trong query: `?stage=A,B` hoặc `?stage=A&stage=B` → `['A', 'B']`. */
const commaList = ({ value }: { value: unknown }): unknown => {
  const parts = Array.isArray(value) ? value : [value];
  if (!parts.every((part) => typeof part === 'string')) {
    return value;
  }
  return [
    ...new Set(
      (parts as string[])
        .flatMap((part) => part.split(','))
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    ),
  ];
};

/** Số tiền (đồng): số nguyên không âm. */
function Amount(field: string): PropertyDecorator {
  return (target, key) => {
    IsInt({ message: `${field} phải là số nguyên (đồng)` })(target, key);
    Min(0, { message: `${field} không được âm` })(target, key);
    Max(MAX_AMOUNT, { message: `${field} quá lớn` })(target, key);
  };
}

/**
 * Tạo giao dịch (TASK-110). Môi giới của giao dịch là người tạo; bước NEGOTIATING. Chuyển bước qua
 * `POST /deals/:id/stage`.
 */
export class CreateDealDto {
  @IsUUID('all', { message: 'customerId phải là UUID' })
  customerId!: string;

  @IsUUID('all', { message: 'propertyId phải là UUID' })
  propertyId!: string;

  @IsOptional()
  @Amount('dealPrice')
  dealPrice?: number;

  @IsOptional()
  @Amount('depositAmount')
  depositAmount?: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'depositAt phải là thời điểm ISO 8601' })
  depositAt?: Date;

  @Transform(trimToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  @NoHtml()
  notes?: string;
}

/** Sửa giao dịch, PATCH: chỉ đổi trường được gửi; gửi `null` để xoá. Không đổi khách, BĐS. */
export class UpdateDealDto {
  /** Chống ghi đè: `updatedAt` client đang có; khác bản ghi hiện tại → 409. */
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'expectedUpdatedAt phải là thời điểm ISO 8601' })
  expectedUpdatedAt?: Date;

  @IsOptional()
  @Amount('dealPrice')
  dealPrice?: number | null;

  @IsOptional()
  @Amount('depositAmount')
  depositAmount?: number | null;

  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'depositAt phải là thời điểm ISO 8601' })
  depositAt?: Date | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  @NoHtml()
  notes?: string | null;
}

/** Các trường sửa được qua PATCH. */
export const EDITABLE_DEAL_FIELDS = [
  'dealPrice',
  'depositAmount',
  'depositAt',
  'notes',
] as const satisfies readonly (keyof UpdateDealDto)[];

/** `GET /deals?stage&customerId&propertyId&page&pageSize`. */
export class DealListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(commaList)
  @IsArray()
  @ArrayNotEmpty({ message: 'stage không được để trống' })
  @IsIn(DEAL_STAGES, { each: true, message: `stage chỉ gồm: ${DEAL_STAGES.join(', ')}` })
  stage?: string[];

  @IsOptional()
  @IsUUID('all', { message: 'customerId phải là UUID' })
  customerId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'propertyId phải là UUID' })
  propertyId?: string;
}

/** Chuyển bước giao dịch. */
export class ChangeDealStageDto {
  @IsIn(DEAL_STAGES, { message: `stage phải là một trong: ${DEAL_STAGES.join(', ')}` })
  stage!: DealStage;

  /** Chống ghi đè: khác `updatedAt` hiện tại → 409. */
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'expectedUpdatedAt phải là thời điểm ISO 8601' })
  expectedUpdatedAt?: Date;
}
