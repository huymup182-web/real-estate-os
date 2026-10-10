import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { RateLimiter } from '../common/rate-limit/rate-limiter.js';
import { MailModule } from '../mail/mail.module.js';
import { AccessTokenService } from './access-token.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CurrentUserService } from './current-user.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { LoginService } from './login.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { PermissionService } from './permission.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { TenantGuard } from './tenant.guard.js';

@Module({
  imports: [MailModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    LoginService,
    AccessTokenService,
    RefreshTokenService,
    PasswordResetService,
    PermissionService,
    CurrentUserService,
    RateLimiter,
    // Thứ tự đăng ký = thứ tự chạy: xác thực token rồi mới kiểm tenant/tài khoản.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
  ],
  exports: [AccessTokenService, PermissionService],
})
export class AuthModule {}
