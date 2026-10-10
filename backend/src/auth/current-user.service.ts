import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import type { AuthenticatedUser } from './access-token.service.js';
import { type EffectivePermission, PermissionService } from './permission.service.js';

export interface CurrentUser {
  user: {
    id: string;
    tenantId: string | null;
    fullName: string;
    email: string | null;
    phone: string | null;
    avatarUrl: string | null;
    departmentId: string | null;
    status: string;
  };
  /** null với tài khoản nền tảng (không thuộc công ty). */
  company: { id: string; name: string; slug: string } | null;
  roles: { code: string; name: string }[];
  permissions: EffectivePermission[];
}

interface UserRow {
  id: string;
  tenant_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  department_id: string | null;
  status: string;
  company_name: string | null;
  company_slug: string | null;
  company_status: string | null;
}

@Injectable()
export class CurrentUserService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly permissions: PermissionService,
  ) {}

  /**
   * Thông tin user đang đăng nhập + role + permission hiệu lực để client ẩn/hiện UI (TASK-044).
   * Đọc lại từ DB (không tin dữ liệu cũ trong token): user đã xoá hoặc đổi công ty → 401;
   * user hoặc công ty không còn hoạt động → 403.
   */
  async get(auth: AuthenticatedUser): Promise<CurrentUser> {
    const rows: UserRow[] = await this.dataSource.query(
      `SELECT u.id, u.tenant_id, u.full_name, u.email, u.phone, u.avatar_url, u.department_id,
              u.status, c.name AS company_name, c.slug AS company_slug, c.status AS company_status
         FROM users u
         LEFT JOIN companies c ON c.id = u.tenant_id AND c.deleted_at IS NULL
        WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [auth.userId],
    );
    const row = rows[0];
    if (!row || row.tenant_id !== auth.tenantId) {
      throw new AppException(ErrorCode.UNAUTHENTICATED, 'Token không hợp lệ');
    }
    if (row.status !== 'ACTIVE') {
      throw new AppException(ErrorCode.FORBIDDEN, 'Tài khoản đã bị khoá hoặc ngừng hoạt động');
    }
    if (row.tenant_id !== null && row.company_status !== 'ACTIVE') {
      throw new AppException(ErrorCode.FORBIDDEN, 'Công ty đang bị tạm ngưng');
    }

    const roles: { code: string; name: string }[] = await this.dataSource.query(
      `SELECT r.code, r.name
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
        WHERE ur.user_id = $1
        ORDER BY r.code`,
      [row.id],
    );

    return {
      user: {
        id: row.id,
        tenantId: row.tenant_id,
        fullName: row.full_name,
        email: row.email,
        phone: row.phone,
        avatarUrl: row.avatar_url,
        departmentId: row.department_id,
        status: row.status,
      },
      // Tới đây công ty (nếu có) chắc chắn tồn tại và đang hoạt động.
      company:
        row.tenant_id !== null
          ? { id: row.tenant_id, name: String(row.company_name), slug: String(row.company_slug) }
          : null,
      roles,
      permissions: await this.permissions.getEffectivePermissions(row.id),
    };
  }
}
