import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LoginService } from './login.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, LoginService],
})
export class AuthModule {}
