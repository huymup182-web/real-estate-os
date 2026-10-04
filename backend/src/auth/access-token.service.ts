import { Inject, Injectable } from '@nestjs/common';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';

import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import type { AppConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/app-config.module.js';

/** Access token sống 15 phút (phase0/02-ARCHITECTURE.md). */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** Chỉ chấp nhận HS256; token ký bằng thuật toán khác (kể cả `none`) bị từ chối. */
const ALGORITHM = 'HS256';

/**
 * Nội dung access token: `sub` = user id, `tid` = tenant id (null với tài khoản nền tảng).
 * Không chứa permission để đổi quyền có hiệu lực ngay. `sid` (phiên) được thêm cùng refresh token (TASK-040).
 */
export interface AccessTokenClaims {
  sub: string;
  tid: string | null;
}

export interface AuthenticatedUser {
  userId: string;
  tenantId: string | null;
}

@Injectable()
export class AccessTokenService {
  private readonly jwt: JwtService;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.jwt = new JwtService({ secret: config.jwtSecret });
  }

  sign(user: AuthenticatedUser): Promise<string> {
    const claims: AccessTokenClaims = { sub: user.userId, tid: user.tenantId };
    return this.jwt.signAsync(claims, {
      algorithm: ALGORITHM,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
  }

  /** Token hết hạn → 401 TOKEN_EXPIRED (client gọi refresh); token sai/giả mạo → 401 UNAUTHENTICATED. */
  async verify(token: string): Promise<AuthenticatedUser> {
    let claims: Partial<AccessTokenClaims>;
    try {
      claims = await this.jwt.verifyAsync<Partial<AccessTokenClaims>>(token, {
        algorithms: [ALGORITHM],
      });
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        throw new AppException(ErrorCode.TOKEN_EXPIRED);
      }
      throw new AppException(ErrorCode.UNAUTHENTICATED, 'Token không hợp lệ');
    }
    if (
      typeof claims.sub !== 'string' ||
      !(typeof claims.tid === 'string' || claims.tid === null)
    ) {
      throw new AppException(ErrorCode.UNAUTHENTICATED, 'Token không hợp lệ');
    }
    return { userId: claims.sub, tenantId: claims.tid };
  }
}
