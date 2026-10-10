import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../auth/password.js';
import { NoHtml } from '../../common/validation/no-html.decorator.js';
import { MAX_USER_ROLES, PHONE_MESSAGE, PHONE_PATTERN } from '../user-values.js';

export const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Chuỗi rỗng sau khi trim coi như không gửi. */
export const trimToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = trim({ value });
  return trimmed === '' ? undefined : trimmed;
};

/**
 * `POST /users` (TASK-103): admin tạo tài khoản nhân viên trong công ty. Cần email hoặc số điện thoại để
 * đăng nhập; mật khẩu ban đầu do admin đặt; ít nhất một role.
 */
export class CreateUserDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'fullName không được để trống' })
  @MaxLength(255)
  @NoHtml()
  fullName!: string;

  @Transform(trimToUndefined)
  @ValidateIf((dto: CreateUserDto) => dto.email !== undefined || dto.phone === undefined)
  @IsEmail({}, { message: 'email không hợp lệ (cần email hoặc số điện thoại)' })
  email?: string;

  @Transform(trimToUndefined)
  @IsOptional()
  @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  phone?: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `password phải có ít nhất ${PASSWORD_MIN_LENGTH} ký tự`,
  })
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  /** Phòng ban; không gửi hoặc null = chưa thuộc phòng ban nào. */
  @IsOptional()
  @IsUUID('all', { message: 'departmentId không hợp lệ' })
  departmentId?: string | null;

  @IsArray()
  @ArrayMinSize(1, { message: 'Cần chọn ít nhất một vai trò' })
  @ArrayMaxSize(MAX_USER_ROLES)
  @ArrayUnique({ message: 'roleIds bị trùng' })
  @IsUUID('all', { each: true, message: 'roleIds không hợp lệ' })
  roleIds!: string[];
}
