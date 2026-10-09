import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { NoHtml } from '../../common/validation/no-html.decorator.js';
import { MAX_VERIFY_INTERVAL_DAYS } from '../../properties/property-values.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** `PATCH /company` (TASK-105): chỉ sửa trường có gửi. Slug và trạng thái không đổi qua API này. */
export class UpdateCompanyDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name không được để trống' })
  @MaxLength(255)
  @NoHtml()
  name?: string;

  /** Số ngày BĐS phải được xác minh lại (TASK-062, TASK-098). */
  @IsOptional()
  @IsInt({ message: 'verifyIntervalDays phải là số nguyên' })
  @Min(1)
  @Max(MAX_VERIFY_INTERVAL_DAYS)
  verifyIntervalDays?: number;
}

/** `PATCH /departments/:id`: chỉ sửa trường có gửi; `managerId: null` để bỏ trưởng phòng. */
export class UpdateDepartmentDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name không được để trống' })
  @MaxLength(255)
  @NoHtml()
  name?: string;

  @ValidateIf((dto: UpdateDepartmentDto) => dto.managerId !== undefined && dto.managerId !== null)
  @IsUUID('all', { message: 'managerId không hợp lệ' })
  managerId?: string | null;
}

/** `POST /departments`. */
export class CreateDepartmentDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name không được để trống' })
  @MaxLength(255)
  @NoHtml()
  name!: string;

  @ValidateIf((dto: CreateDepartmentDto) => dto.managerId !== undefined && dto.managerId !== null)
  @IsUUID('all', { message: 'managerId không hợp lệ' })
  managerId?: string | null;
}
