import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AccessTokenService } from './access-token.service.js';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { LoginService } from './login.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    LoginService,
    AccessTokenService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AccessTokenService],
})
export class AuthModule {}
