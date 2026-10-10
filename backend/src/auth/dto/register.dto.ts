import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { NoHtml } from '../../common/validation/no-html.decorator.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../password.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Chuỗi rỗng sau khi trim coi như không gửi (để trường tuỳ chọn không bị báo sai định dạng). */
const trimToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = trim({ value });
  return trimmed === '' ? undefined : trimmed;
};

/**
 * Đăng ký công khai: tạo công ty mới và tài khoản quản trị đầu tiên.
 * Cần ít nhất một trong email/phone (dùng để đăng nhập).
 */
export class RegisterDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'companyName không được để trống' })
  @MaxLength(255)
  @NoHtml()
  companyName!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'fullName không được để trống' })
  @MaxLength(255)
  @NoHtml()
  fullName!: string;

  @Transform(trimToUndefined)
  @ValidateIf((dto: RegisterDto) => dto.email !== undefined || dto.phone === undefined)
  // isEmail tự giới hạn độ dài email (tối đa 254 ký tự).
  @IsEmail({}, { message: 'email không hợp lệ (cần email hoặc số điện thoại)' })
  email?: string;

  @Transform(trimToUndefined)
  @IsOptional()
  @Matches(/^\+[0-9]{8,15}$/, { message: 'phone phải theo dạng quốc tế, vd +84901234567' })
  phone?: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `password phải có ít nhất ${PASSWORD_MIN_LENGTH} ký tự`,
  })
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
