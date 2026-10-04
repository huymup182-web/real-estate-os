import { Body, Controller, Post } from '@nestjs/common';

import { AuthService, type RegisterResult } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** `POST /api/v1/auth/register` → 201. Không trả token: đăng nhập ở `POST /auth/login` (TASK-037). */
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<RegisterResult> {
    return this.authService.register(dto);
  }
}
