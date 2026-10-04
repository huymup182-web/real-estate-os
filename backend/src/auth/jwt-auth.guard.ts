import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { getRequestContext } from '../common/logging/request-context.js';
import { AccessTokenService, type AuthenticatedUser } from './access-token.service.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthenticatedUser;
}

/**
 * Guard toàn cục: mọi route cần header `Authorization: Bearer <accessToken>`, trừ route `@Public()`.
 * Token hợp lệ → gắn `req.user` và `tenantId`/`userId` vào request context (log, các bước sau).
 * tenantId chỉ lấy từ token, không bao giờ từ body/query.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessTokens: AccessTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers['authorization'];
    const match = typeof header === 'string' ? /^Bearer ([^\s]+)$/i.exec(header) : null;
    if (!match?.[1]) {
      throw new AppException(ErrorCode.UNAUTHENTICATED);
    }

    const user = await this.accessTokens.verify(match[1]);
    req.user = user;
    const requestContext = getRequestContext();
    if (requestContext) {
      requestContext.userId = user.userId;
      requestContext.tenantId = user.tenantId ?? undefined;
    }
    return true;
  }
}
