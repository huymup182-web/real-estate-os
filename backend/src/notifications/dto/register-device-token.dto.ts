import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

import { DEVICE_PLATFORMS, type DevicePlatform, FCM_TOKEN_MAX } from '../notification-values.js';
import { trim } from './create-saved-search.dto.js';

/** Đăng ký token FCM của thiết bị đang đăng nhập (TASK-094). */
export class RegisterDeviceTokenDto {
  @Transform(trim)
  @IsString({ message: 'token phải là chuỗi' })
  @IsNotEmpty({ message: 'token không được để trống' })
  @MaxLength(FCM_TOKEN_MAX, { message: `token tối đa ${FCM_TOKEN_MAX} ký tự` })
  @Matches(/^\S+$/, { message: 'token không được chứa khoảng trắng' })
  token!: string;

  @IsIn(DEVICE_PLATFORMS, { message: `platform phải là ${DEVICE_PLATFORMS.join(' | ')}` })
  platform!: DevicePlatform;
}
