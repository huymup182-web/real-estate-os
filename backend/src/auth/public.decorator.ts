import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Đánh dấu route không cần đăng nhập (vd đăng ký, đăng nhập, health check).
 * Mặc định mọi route đều cần access token hợp lệ.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
