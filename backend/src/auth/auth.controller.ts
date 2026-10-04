import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';

import type { AuthenticatedUser } from './access-token.service.js';

import { AuthService, type RegisterResult } from './auth.service.js';
import { type ClientRequest, clientInfoFrom } from './client-info.js';
import { type CurrentUser, CurrentUserService } from './current-user.service.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { type LoginResult, LoginService } from './login.service.js';
import { type ForgotPasswordResult, PasswordResetService } from './password-reset.service.js';
import { Public } from './public.decorator.js';
import { RefreshTokenService, type TokenPair } from './refresh-token.service.js';

/** register/login/refresh/forgot-password/reset-password là route công khai; logout và me cần access token. */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly loginService: LoginService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly passwordReset: PasswordResetService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** `POST /api/v1/auth/register` → 201. Không trả token: đăng nhập ở `POST /auth/login` (TASK-037). */
  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<RegisterResult> {
    return this.authService.register(dto);
  }

  /** `POST /api/v1/auth/login` → 200 `{ accessToken, refreshToken, expiresIn, user }`. */
  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: ClientRequest): Promise<LoginResult> {
    return this.loginService.login(dto, clientInfoFrom(req));
  }

  /** `POST /api/v1/auth/refresh` → 200 cặp token mới `{ accessToken, refreshToken, expiresIn }` (TASK-040). */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto, @Req() req: ClientRequest): Promise<TokenPair> {
    return this.refreshTokens.rotate(dto.refreshToken, clientInfoFrom(req));
  }

  /**
   * `POST /api/v1/auth/logout` → 204: thu hồi phiên hiện tại (`sid` trong access token, TASK-041).
   * Gọi lại khi phiên đã thu hồi vẫn trả 204.
   */
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: { user: AuthenticatedUser }): Promise<void> {
    await this.refreshTokens.revokeSession(req.user);
  }

  /**
   * `POST /api/v1/auth/forgot-password` → 200 `{ expiresIn }` (TASK-042). Gửi mã OTP 6 số qua email.
   * Luôn trả cùng kết quả dù email có tài khoản hay không.
   */
  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<ForgotPasswordResult> {
    return this.passwordReset.requestReset(dto.email);
  }

  /**
   * `POST /api/v1/auth/reset-password` → 204 (TASK-043): đặt mật khẩu mới bằng mã OTP,
   * rồi thu hồi mọi phiên đăng nhập của user. Mã sai/hết hạn → 400 VALIDATION_ERROR.
   */
  @Public()
  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.passwordReset.resetPassword(dto.email, dto.code, dto.newPassword);
  }

  /** `GET /api/v1/auth/me` → user, công ty, role và permission + scope hiệu lực (TASK-044). */
  @Get('me')
  me(@Req() req: { user: AuthenticatedUser }): Promise<CurrentUser> {
    return this.currentUser.get(req.user);
  }
}
