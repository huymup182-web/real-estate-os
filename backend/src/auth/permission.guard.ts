import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  SetMetadata,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';
import type { PermissionScope } from './permission.service.js';

export const REQUIRED_PERMISSION_KEY = 'requiredPermission';

interface PermissionRequest extends AuthenticatedRequest {
  /** Scope của permission route yêu cầu, do PermissionGuard gắn vào. */
  permissionScope?: PermissionScope;
}

/**
 * Kiểm quyền theo permission (không theo tên role, phase0/04-RBAC.md mục 5):
 * route có `@RequirePermission(code)` chỉ cho qua khi `req.user.permissions` có `code`.
 * Thiếu quyền → 403 FORBIDDEN. Scope của quyền được gắn vào request để service áp vào truy vấn.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string | undefined>(REQUIRED_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined) {
      return true;
    }
    const req = context.switchToHttp().getRequest<PermissionRequest>();
    // Route @Public() không có user: dùng chung với @RequirePermission là cấu hình sai, chặn lại.
    if (!req.user) {
      throw new AppException(ErrorCode.UNAUTHENTICATED);
    }
    const scope = req.user.permissions[required];
    if (scope === undefined) {
      throw new AppException(ErrorCode.FORBIDDEN);
    }
    req.permissionScope = scope;
    return true;
  }
}

/**
 * Yêu cầu user có permission `code` (vd `customer.edit`). Đặt trên handler hoặc controller;
 * đặt trên handler thì ghi đè controller. Chạy sau JwtAuthGuard nên `req.user` đã có quyền (TASK-045).
 */
export function RequirePermission(code: string): MethodDecorator & ClassDecorator {
  return applyDecorators(SetMetadata(REQUIRED_PERMISSION_KEY, code), UseGuards(PermissionGuard));
}

/**
 * Lấy scope của permission route yêu cầu (OWN/TEAM/DEPARTMENT/COMPANY/PLATFORM),
 * vd `list(@GrantedScope() scope: PermissionScope)`. Chỉ dùng trên route có `@RequirePermission`.
 */
export const GrantedScope = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PermissionScope => {
    const scope = context.switchToHttp().getRequest<PermissionRequest>().permissionScope;
    if (scope === undefined) {
      throw new Error('@GrantedScope() chỉ dùng trên route có @RequirePermission');
    }
    return scope;
  },
);
