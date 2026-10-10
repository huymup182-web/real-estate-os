import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Phạm vi dữ liệu của permission, từ hẹp tới rộng (phase0/04-RBAC.md mục 2). */
export const PERMISSION_SCOPES = ['OWN', 'TEAM', 'DEPARTMENT', 'COMPANY', 'PLATFORM'] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

export interface EffectivePermission {
  code: string;
  scope: PermissionScope;
}

/** Role và quyền hiệu lực của user, gắn vào `req.user` ở mỗi request đã đăng nhập (TASK-045). */
export interface UserAccess {
  /** Mã các role chưa xoá của user. Chỉ để hiển thị/ghi log: không kiểm quyền theo tên role. */
  roles: string[];
  /** permission code → scope rộng nhất. Không có key = không có quyền. */
  permissions: Partial<Record<string, PermissionScope>>;
}

/**
 * Cache quyền trong process sống 60 giây: đổi role/quyền trực tiếp trong DB (hoặc ở instance khác)
 * có hiệu lực chậm nhất sau 60 giây. API đổi role/quyền phải gọi `invalidate` để có hiệu lực ngay.
 */
export const ACCESS_CACHE_TTL_MS = 60_000;

/**
 * Quyền hiệu lực của user = hợp permission của mọi role đang có (role chưa xoá),
 * mỗi permission lấy scope rộng nhất (phase0/04-RBAC.md mục 1).
 * Dùng cho `GET /auth/me` (TASK-044, luôn đọc mới) và `req.user` (TASK-045, qua cache).
 */
@Injectable()
export class PermissionService {
  private readonly cache = new Map<string, { access: UserAccess; expiresAt: number }>();

  constructor(private readonly dataSource: DataSource) {}

  /** Role + quyền hiệu lực của user, có cache (ACCESS_CACHE_TTL_MS). */
  async getUserAccess(userId: string): Promise<UserAccess> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.access;
    }
    const [roles, permissions] = await Promise.all([
      this.getRoleCodes(userId),
      this.getEffectivePermissions(userId),
    ]);
    const access: UserAccess = {
      roles,
      permissions: Object.fromEntries(permissions.map((p) => [p.code, p.scope])),
    };
    this.cache.set(userId, { access, expiresAt: Date.now() + ACCESS_CACHE_TTL_MS });
    return access;
  }

  /** Xoá cache của một user (khi đổi role của user) hoặc toàn bộ (khi đổi quyền của role). */
  invalidate(userId?: string): void {
    if (userId === undefined) {
      this.cache.clear();
    } else {
      this.cache.delete(userId);
    }
  }

  private async getRoleCodes(userId: string): Promise<string[]> {
    const rows: { code: string }[] = await this.dataSource.query(
      `SELECT r.code
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
        WHERE ur.user_id = $1
        ORDER BY r.code`,
      [userId],
    );
    return rows.map((row) => row.code);
  }

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
