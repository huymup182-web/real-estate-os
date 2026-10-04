import { Body, Controller, HttpCode, Post } from '@nestjs/common';

import { AuthService, type RegisterResult } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { type LoginResult, LoginService } from './login.service.js';
import { Public } from './public.decorator.js';

@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly loginService: LoginService,
  ) {}

  /** `POST /api/v1/auth/register` → 201. Không trả token: đăng nhập ở `POST /auth/login` (TASK-037). */
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<RegisterResult> {
    return this.authService.register(dto);
  }

  /** `POST /api/v1/auth/login` → 200 `{ accessToken, expiresIn, user }`; refresh token thêm ở TASK-040. */
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<LoginResult> {
    return this.loginService.login(dto);
  }
}
