import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { NoHtml } from '../../common/validation/no-html.decorator.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Trường tuỳ chọn: chuỗi rỗng sau khi trim coi như không có. */
const trimToNull = ({ value }: { value: unknown }): unknown => {
  const trimmed = trim({ value });
  return trimmed === '' ? null : trimmed;
};

/**
 * Nhập hoặc thay thông tin chủ nhà của BĐS (TASK-055), PUT: gửi đủ thông tin, trường tuỳ chọn không gửi
 * hoặc `null` thì để trống. Mỗi BĐS có bản ghi chủ nhà riêng (không gộp theo số điện thoại).
 */
export class SetPropertyOwnerDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'fullName không được để trống' })
  @MaxLength(255)
  @NoHtml()
  fullName!: string;

  @Transform(trim)
  @IsString()
  @Matches(/^\+[0-9]{8,15}$/, { message: 'phone phải theo dạng quốc tế, vd +84901234567' })
  phone!: string;

  @Transform(trimToNull)
  @IsOptional()
  // isEmail tự giới hạn độ dài email (tối đa 254 ký tự).
  @IsEmail({}, { message: 'email không hợp lệ' })
  email?: string | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @NoHtml()
  notes?: string | null;

  /** Chống ghi đè như khi sửa BĐS: khác `updatedAt` hiện tại của BĐS → 409. */
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'expectedUpdatedAt phải là thời điểm ISO 8601' })
  expectedUpdatedAt?: Date;
}
