import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';

/** `POST /auth/forgot-password`: email nhận mã OTP đặt lại mật khẩu. */
export class ForgotPasswordDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail({}, { message: 'email không hợp lệ' })
  email!: string;
}
