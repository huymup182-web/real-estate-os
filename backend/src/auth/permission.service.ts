import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Phạm vi dữ liệu của permission, từ hẹp tới rộng (phase0/04-RBAC.md mục 2). */
export const PERMISSION_SCOPES = ['OWN', 'TEAM', 'DEPARTMENT', 'COMPANY', 'PLATFORM'] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

export interface EffectivePermission {
  code: string;
  scope: PermissionScope;
}

/**
 * Quyền hiệu lực của user = hợp permission của mọi role đang có (role chưa xoá),
 * mỗi permission lấy scope rộng nhất (phase0/04-RBAC.md mục 1).
 * Dùng cho `GET /auth/me` (TASK-044) và guard phân quyền (TASK-046).
 */
@Injectable()
export class PermissionService {
  constructor(private readonly dataSource: DataSource) {}

  async getEffectivePermissions(userId: string): Promise<EffectivePermission[]> {
    return this.dataSource.query(
      `SELECT DISTINCT ON (p.code) p.code, rp.scope
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
         JOIN role_permissions rp ON rp.role_id = r.id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = $1
        ORDER BY p.code, array_position($2::text[], rp.scope::text) DESC`,
      [userId, PERMISSION_SCOPES],
    );
  }
}
