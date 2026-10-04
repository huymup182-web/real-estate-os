import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../password.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** `POST /auth/reset-password`: email + mã OTP 6 số đã nhận (TASK-042) + mật khẩu mới. */
export class ResetPasswordDto {
  @Transform(trim)
  @IsEmail({}, { message: 'email không hợp lệ' })
  email!: string;

  @Transform(trim)
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code phải gồm 6 chữ số' })
  code!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `newPassword phải có ít nhất ${PASSWORD_MIN_LENGTH} ký tự`,
  })
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword!: string;
}
