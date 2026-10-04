import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { PASSWORD_MAX_LENGTH } from '../password.js';

/**
 * Đăng nhập bằng email hoặc số điện thoại (dạng `+84…`) kèm mật khẩu (phase0/01-PRD.md US-01).
 * Không kiểm độ dài tối thiểu của mật khẩu ở đây: sai thì chỉ báo "sai thông tin đăng nhập".
 */
export class LoginDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'identifier không được để trống' })
  @MaxLength(255)
  identifier!: string;

  @IsString()
  @IsNotEmpty({ message: 'password không được để trống' })
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
