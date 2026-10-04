import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';

import { AuthService, type RegisterResult } from './auth.service.js';
import { type ClientRequest, clientInfoFrom } from './client-info.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { type LoginResult, LoginService } from './login.service.js';
import { Public } from './public.decorator.js';
import { RefreshTokenService, type TokenPair } from './refresh-token.service.js';

@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly loginService: LoginService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  /** `POST /api/v1/auth/register` → 201. Không trả token: đăng nhập ở `POST /auth/login` (TASK-037). */
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<RegisterResult> {
    return this.authService.register(dto);
  }

  /** `POST /api/v1/auth/login` → 200 `{ accessToken, refreshToken, expiresIn, user }`. */
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: ClientRequest): Promise<LoginResult> {
    return this.loginService.login(dto, clientInfoFrom(req));
  }

  /** `POST /api/v1/auth/refresh` → 200 cặp token mới `{ accessToken, refreshToken, expiresIn }` (TASK-040). */
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto, @Req() req: ClientRequest): Promise<TokenPair> {
    return this.refreshTokens.rotate(dto.refreshToken, clientInfoFrom(req));
  }
}
