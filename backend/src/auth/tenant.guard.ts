import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';

import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

interface AccountStatusRow {
  tenant_id: string | null;
  status: string;
  company_status: string | null;
}

/**
 * Guard toàn cục chạy ngay sau JwtAuthGuard (phase0/02-ARCHITECTURE.md mục 3–4, TASK-047).
 * Mỗi request đã đăng nhập kiểm lại trong DB (không cache, để khoá tài khoản có hiệu lực ngay):
 * - user đã xoá, hoặc không còn thuộc công ty ghi trong token → 401 UNAUTHENTICATED;
 * - user không ACTIVE, hoặc công ty không ACTIVE → 403 FORBIDDEN.
 * tenantId dùng cho truy vấn chỉ lấy từ token (`req.user.tenantId`), không bao giờ từ body/query.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) {
      throw new AppException(ErrorCode.UNAUTHENTICATED);
    }

    const rows: AccountStatusRow[] = await this.dataSource.query(
      `SELECT u.tenant_id, u.status, c.status AS company_status
         FROM users u
         LEFT JOIN companies c ON c.id = u.tenant_id AND c.deleted_at IS NULL
        WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [user.userId],
    );
    const account = rows[0];
    if (!account || account.tenant_id !== user.tenantId) {
      throw new AppException(ErrorCode.UNAUTHENTICATED, 'Token không hợp lệ');
    }
    if (account.status !== 'ACTIVE') {
      throw new AppException(ErrorCode.FORBIDDEN, 'Tài khoản đã bị khoá hoặc ngừng hoạt động');
    }
    if (account.tenant_id !== null && account.company_status !== 'ACTIVE') {
      throw new AppException(ErrorCode.FORBIDDEN, 'Công ty đang bị tạm ngưng');
    }
    return true;
  }
}

/**
 * tenantId của user đang đăng nhập (lấy từ token) để truyền cho TenantRepository,
 * vd `list(@TenantId() tenantId: string)`. Tài khoản nền tảng (không thuộc công ty) → 403:
 * SUPER_ADMIN không đọc dữ liệu nghiệp vụ của công ty qua API thường (phase0/04-RBAC.md mục 4).
 */
export const TenantId = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) {
    throw new AppException(ErrorCode.UNAUTHENTICATED);
  }
  if (user.tenantId === null) {
    throw new AppException(
      ErrorCode.FORBIDDEN,
      'Tài khoản nền tảng không truy cập được dữ liệu của công ty',
    );
  }
  return user.tenantId;
});
