import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** `POST /auth/refresh`: đổi refresh token đang có lấy cặp token mới. */
export class RefreshDto {
  @IsString()
  @IsNotEmpty({ message: 'refreshToken không được để trống' })
  @MaxLength(255)
  refreshToken!: string;
}
