import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { AuditService } from '../audit/audit.service.js';
import { COMPANY_ADMIN_ROLE } from '../auth/default-roles.js';
import { hashPassword } from '../auth/password.js';
import { exceedingGrants, type PermissionGrant } from '../auth/permission-grant.js';
import {
  type PermissionScope,
  PermissionService,
  type UserAccess,
} from '../auth/permission.service.js';
import { scopeCondition } from '../auth/record-scope.js';
import { AppException, type ErrorDetail } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { Paginated } from '../common/response/paginated.js';
import { assertTenant } from '../database/tenant.repository.js';
import type { Actor } from '../properties/properties.service.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';
import type { UserListQueryDto } from './dto/user-list-query.dto.js';
import type { UserStatus } from './user-values.js';

export interface UserResponse {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  status: UserStatus;
  department: { id: string; name: string } | null;
  roles: { id: string; code: string; name: string }[];
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Lựa chọn cho form tạo/sửa user: role và phòng ban của công ty. */
export interface UserFormOptions {
  roles: { id: string; code: string; name: string }[];
  departments: { id: string; name: string }[];
}

interface UserRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  status: UserStatus;
  department_id: string | null;
  department_name: string | null;
  roles: { id: string; code: string; name: string }[];
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const USER_SELECT = `
  SELECT u.id, u.full_name, u.email, u.phone, u.avatar_url, u.status, u.last_login_at, u.created_at,
         u.updated_at, d.id AS department_id, d.name AS department_name,
         coalesce(json_agg(json_build_object('id', r.id, 'code', r.code, 'name', r.name) ORDER BY r.code)
                  FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
    FROM users u
    LEFT JOIN departments d ON d.id = u.department_id AND d.deleted_at IS NULL
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL`;

function toResponse(row: UserRow): UserResponse {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    avatarUrl: row.avatar_url,
    status: row.status,
    department:
      row.department_id && row.department_name
        ? { id: row.department_id, name: row.department_name }
        : null,
    roles: row.roles,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Quản lý người dùng trong công ty (TASK-103, phase0/01-PRD.md US-03). Không có xoá: nhân viên nghỉ thì
 * chuyển INACTIVE để giữ lịch sử BĐS, khách, giao dịch họ phụ trách.
 * - Xem theo phạm vi `user.view` (TEAM/DEPARTMENT/COMPANY như record-scope, user tự là "người phụ trách").
 * - Tạo cần `user.manage` phạm vi COMPANY; sửa/đổi trạng thái cần user nằm trong phạm vi `user.manage`.
 * - Quy tắc an toàn (phase0/04-RBAC.md mục 6): không gán role có quyền vượt quyền của chính mình; không tự
 *   đổi role/trạng thái của mình; công ty luôn còn ít nhất một COMPANY_ADMIN đang hoạt động.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly permissions: PermissionService,
  ) {}

  async list(
    actor: Actor,
    query: UserListQueryDto,
    viewScope: PermissionScope,
  ): Promise<Paginated<UserResponse>> {
    let ids = this.visible(actor, viewScope);
    if (query.q) {
      ids = ids.andWhere(
        `(u.full_name ILIKE :q ESCAPE '\\' OR u.email::text ILIKE :q ESCAPE '\\'
          OR u.phone LIKE :q ESCAPE '\\')`,
        { q: `%${query.q.replace(/[\\%_]/g, '\\$&')}%` },
      );
    }
    if (query.status) {
      ids = ids.andWhere('u.status = :status', { status: query.status });
    }
    if (query.departmentId) {
      ids = ids.andWhere('u.department_id = :departmentId', { departmentId: query.departmentId });
    }
    if (query.roleId) {
      ids = ids.andWhere(
        'EXISTS (SELECT 1 FROM user_roles fr WHERE fr.user_id = u.id AND fr.role_id = :roleId)',
        { roleId: query.roleId },
      );
    }
    const total = await ids.clone().select('count(*)::int', 'count').getRawOne<{ count: number }>();
    const page = await ids
      .select('u.id', 'id')
      .orderBy('u.created_at', 'DESC')
      .addOrderBy('u.id', 'DESC')
      .offset(query.offset)
      .limit(query.pageSize)
      .getRawMany<{ id: string }>();
    const users = await this.load(page.map((row) => row.id));
    return new Paginated(users, query.page, query.pageSize, total?.count ?? 0);
  }

  /** User trong phạm vi xem; ngoài phạm vi hoặc không tồn tại → 404. */
  async findOne(actor: Actor, id: string, viewScope: PermissionScope): Promise<UserResponse> {
    if (!(await this.inScope(actor, id, viewScope))) {
      throw notFound();
    }
    return this.loadOne(id);
  }

  async options(actor: Actor): Promise<UserFormOptions> {
    assertTenant(actor.tenantId);
    const [roles, departments] = await Promise.all([
      this.dataSource.query(
        `SELECT id, code, name FROM roles
          WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY is_system DESC, name`,
        [actor.tenantId],
      ) as Promise<UserFormOptions['roles']>,
      this.dataSource.query(
        `SELECT id, name FROM departments WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY name`,
        [actor.tenantId],
      ) as Promise<UserFormOptions['departments']>,
    ]);
    return { roles, departments };
  }

  async create(actor: Actor, dto: CreateUserDto, access: UserAccess): Promise<UserResponse> {
    assertTenant(actor.tenantId);
    if (access.permissions['user.manage'] !== 'COMPANY') {
      throw new AppException(
        ErrorCode.FORBIDDEN,
        'Chỉ người quản lý người dùng toàn công ty mới tạo được tài khoản',
      );
    }
    await this.assertDepartment(actor, dto.departmentId ?? null);
    await this.assertAssignableRoles(actor, dto.roleIds, access);
    await this.assertContactAvailable({ email: dto.email ?? null, phone: dto.phone ?? null });
    const passwordHash = await hashPassword(dto.password);

    const id = await this.dataSource.transaction(async (manager) => {
      const [row] = (await manager.query(
        `INSERT INTO users (tenant_id, email, phone, password_hash, full_name, department_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          actor.tenantId,
          dto.email ?? null,
          dto.phone ?? null,
          passwordHash,
          dto.fullName,
          dto.departmentId ?? null,
        ],
      )) as { id: string }[];
      if (!row) {
        throw new Error('INSERT users không trả về id');
      }
      await this.setRoles(manager, actor, row.id, dto.roleIds);
      await this.audit.record(manager, {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'user.create',
        entityType: 'user',
        entityId: row.id,
        changes: {
          fullName: [null, dto.fullName],
          email: [null, dto.email ?? null],
          phone: [null, dto.phone ?? null],
          departmentId: [null, dto.departmentId ?? null],
          roles: [null, await this.roleCodes(manager, dto.roleIds)],
        },
      });
      return row.id;
    });
    return this.loadOne(id);
  }

  async update(
    actor: Actor,
    id: string,
    dto: UpdateUserDto,
    access: UserAccess,
  ): Promise<UserResponse> {
    await this.assertManageable(actor, id, access);
    const current = await this.loadOne(id);
    if (dto.roleIds !== undefined && id === actor.userId) {
      throw rule('Không thể tự đổi vai trò của chính mình');
    }
    const email = dto.email === undefined ? current.email : dto.email;
    const phone = dto.phone === undefined ? current.phone : dto.phone;
    if (email === null && phone === null) {
      throw invalid([{ field: 'email', message: 'Cần email hoặc số điện thoại' }]);
    }
    if (dto.departmentId !== undefined) {
      await this.assertDepartment(actor, dto.departmentId);
    }
    if (dto.roleIds !== undefined) {
      await this.assertAssignableRoles(actor, dto.roleIds, access);
    }
    await this.assertContactAvailable(
      {
        email: dto.email !== undefined && dto.email !== current.email ? dto.email : null,
        phone: dto.phone !== undefined && dto.phone !== current.phone ? dto.phone : null,
      },
      id,
    );

    await this.dataSource.transaction(async (manager) => {
      const changes: Record<string, [unknown, unknown]> = {};
      const sets: string[] = [];
      const params: unknown[] = [id, actor.tenantId];
      const set = (column: string, field: string, before: unknown, after: unknown): void => {
        if (after === undefined || after === before) {
          return;
        }
        params.push(after);
        sets.push(`${column} = $${params.length}`);
        changes[field] = [before, after];
      };
      set('full_name', 'fullName', current.fullName, dto.fullName);
      set('email', 'email', current.email, dto.email);
      set('phone', 'phone', current.phone, dto.phone);
      set('department_id', 'departmentId', current.department?.id ?? null, dto.departmentId);
      if (sets.length > 0) {
        await manager.query(
          `UPDATE users SET ${sets.join(', ')} WHERE id = $1 AND tenant_id = $2`,
          params,
        );
      }

      if (dto.roleIds !== undefined) {
        const before = current.roles.map((role) => role.id).sort();
        const after = [...dto.roleIds].sort();
        if (before.join() !== after.join()) {
          if (current.status === 'ACTIVE') {
            const keepsAdmin = (await this.roleCodes(manager, dto.roleIds)).includes(
              COMPANY_ADMIN_ROLE,
            );
            if (!keepsAdmin) {
              await this.assertAnotherActiveAdmin(manager, actor, id);
            }
          }
          await manager.query(`DELETE FROM user_roles WHERE user_id = $1`, [id]);
          await this.setRoles(manager, actor, id, dto.roleIds);
          changes['roles'] = [
            current.roles.map((role) => role.code),
            await this.roleCodes(manager, dto.roleIds),
          ];
        }
      }

      if (Object.keys(changes).length > 0) {
        await this.audit.record(manager, {
          tenantId: actor.tenantId,
          userId: actor.userId,
          action: 'user.update',
          entityType: 'user',
          entityId: id,
          changes,
        });
      }
    });
    if (dto.roleIds !== undefined) {
      this.permissions.invalidate(id);
    }
    return this.loadOne(id);
  }

  /**
   * Đổi trạng thái tài khoản. Rời ACTIVE thì thu hồi mọi phiên đăng nhập (mọi request sau đó bị TenantGuard
   * chặn ngay). Không tự đổi trạng thái của mình; không làm công ty mất COMPANY_ADMIN đang hoạt động cuối cùng.
   */
  async changeStatus(
    actor: Actor,
    id: string,
    status: UserStatus,
    access: UserAccess,
  ): Promise<UserResponse> {
    await this.assertManageable(actor, id, access);
    if (id === actor.userId) {
      throw rule('Không thể tự đổi trạng thái tài khoản của chính mình');
    }
    const current = await this.loadOne(id);
    if (current.status === status) {
      return current;
    }
    await this.dataSource.transaction(async (manager) => {
      if (
        current.status === 'ACTIVE' &&
        current.roles.some((role) => role.code === COMPANY_ADMIN_ROLE)
      ) {
        await this.assertAnotherActiveAdmin(manager, actor, id);
      }
      await manager.query(`UPDATE users SET status = $3 WHERE id = $1 AND tenant_id = $2`, [
        id,
        actor.tenantId,
        status,
      ]);
      if (status !== 'ACTIVE') {
        await manager.query(
          `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
          [id],
        );
      }
      await this.audit.record(manager, {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'user.status',
        entityType: 'user',
        entityId: id,
        changes: { status: [current.status, status] },
      });
    });
    return this.loadOne(id);
  }

  /** Truy vấn user (alias `u`) của công ty, chưa xoá, trong phạm vi `scope`. */
  private visible(actor: Actor, scope: PermissionScope) {
    assertTenant(actor.tenantId);
    return this.dataSource
      .createQueryBuilder()
      .from('users', 'u')
      .where('u.tenant_id = :tenantId', { tenantId: actor.tenantId })
      .andWhere('u.deleted_at IS NULL')
      .andWhere(scopeCondition(scope, { agent: 'u.id', creator: 'u.id' }))
      .setParameter('scopeUserId', actor.userId);
  }

  private async inScope(actor: Actor, id: string, scope: PermissionScope): Promise<boolean> {
    const row = await this.visible(actor, scope)
      .select('1', 'found')
      .andWhere('u.id = :id', { id })
      .getRawOne();
    return row !== undefined;
  }

  /** Không thấy (ngoài `user.view`) → 404; thấy nhưng ngoài phạm vi `user.manage` → 403. */
  private async assertManageable(actor: Actor, id: string, access: UserAccess): Promise<void> {
    const viewScope = access.permissions['user.view'];
    const manageScope = access.permissions['user.manage'];
    if (!viewScope || !(await this.inScope(actor, id, viewScope))) {
      throw notFound();
    }
    if (!manageScope || !(await this.inScope(actor, id, manageScope))) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Không có quyền quản lý người dùng này');
    }
  }

  private async load(ids: string[]): Promise<UserResponse[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = (await this.dataSource.query(
      `${USER_SELECT} WHERE u.id = ANY($1::uuid[]) GROUP BY u.id, d.id`,
      [ids],
    )) as UserRow[];
    const byId = new Map(rows.map((row) => [row.id, toResponse(row)]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  private async loadOne(id: string): Promise<UserResponse> {
    const [user] = await this.load([id]);
    if (!user) {
      throw notFound();
    }
    return user;
  }

  private async assertDepartment(actor: Actor, departmentId: string | null): Promise<void> {
    if (departmentId === null) {
      return;
    }
    const rows: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM departments WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [departmentId, actor.tenantId],
    );
    if (rows.length === 0) {
      throw invalid([{ field: 'departmentId', message: 'Phòng ban không tồn tại' }]);
    }
  }

  /**
   * Role phải thuộc công ty và chưa xoá (sai → 400). Mỗi quyền của role phải nằm trong quyền của người gán,
   * với phạm vi không rộng hơn (vượt → 403), để không ai tự tạo ra tài khoản quyền cao hơn mình.
   */
  private async assertAssignableRoles(
    actor: Actor,
    roleIds: string[],
    access: UserAccess,
  ): Promise<void> {
    const roles: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM roles WHERE id = ANY($1::uuid[]) AND tenant_id = $2 AND deleted_at IS NULL`,
      [roleIds, actor.tenantId],
    );
    if (roles.length !== roleIds.length) {
      throw invalid([{ field: 'roleIds', message: 'Vai trò không tồn tại' }]);
    }
    const granted = (await this.dataSource.query(
      `SELECT DISTINCT p.code, rp.scope
         FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = ANY($1::uuid[])`,
      [roleIds],
    )) as PermissionGrant[];
    if (exceedingGrants(granted, access).length > 0) {
      throw new AppException(
        ErrorCode.FORBIDDEN,
        'Không thể gán vai trò có quyền vượt quá quyền của bạn',
      );
    }
  }

  /** Email/SĐT duy nhất toàn hệ thống (giống đăng ký); `null` = không kiểm. */
  private async assertContactAvailable(
    contact: { email: string | null; phone: string | null },
    exceptUserId?: string,
  ): Promise<void> {
    const details: ErrorDetail[] = [];
    for (const [field, value, message] of [
      ['email', contact.email, 'Email đã được sử dụng'],
      ['phone', contact.phone, 'Số điện thoại đã được sử dụng'],
    ] as const) {
      if (value === null) {
        continue;
      }
      const rows: unknown[] = await this.dataSource.query(
        `SELECT 1 FROM users WHERE ${field} = $1 AND deleted_at IS NULL AND id IS DISTINCT FROM $2`,
        [value, exceptUserId ?? null],
      );
      if (rows.length > 0) {
        details.push({ field, message });
      }
    }
    if (details.length > 0) {
      throw new AppException(
        ErrorCode.CONFLICT,
        'Email hoặc số điện thoại đã được sử dụng',
        details,
      );
    }
  }

  private async setRoles(
    manager: EntityManager,
    actor: Actor,
    userId: string,
    roleIds: string[],
  ): Promise<void> {
    await manager.query(
      `INSERT INTO user_roles (user_id, role_id, tenant_id)
       SELECT $1, unnest($2::uuid[]), $3`,
      [userId, roleIds, actor.tenantId],
    );
  }

  private async roleCodes(manager: EntityManager, roleIds: string[]): Promise<string[]> {
    const rows = (await manager.query(
      `SELECT code FROM roles WHERE id = ANY($1::uuid[]) ORDER BY code`,
      [roleIds],
    )) as { code: string }[];
    return rows.map((row) => row.code);
  }

  /**
   * Công ty phải còn ít nhất một COMPANY_ADMIN đang hoạt động ngoài `userId` (phase0/04-RBAC.md mục 6).
   * Khoá các dòng admin để hai thao tác đồng thời không cùng lúc gỡ hai admin cuối.
   */
  private async assertAnotherActiveAdmin(
    manager: EntityManager,
    actor: Actor,
    userId: string,
  ): Promise<void> {
    const admins = (await manager.query(
      `SELECT u.id, u.status
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL AND r.code = $2
        WHERE u.tenant_id = $1 AND u.deleted_at IS NULL
        ORDER BY u.id
        FOR UPDATE OF u`,
      [actor.tenantId, COMPANY_ADMIN_ROLE],
    )) as { id: string; status: string }[];
    if (!admins.some((admin) => admin.id !== userId && admin.status === 'ACTIVE')) {
      throw rule('Công ty phải còn ít nhất một quản trị công ty đang hoạt động');
    }
  }
}

function notFound(): AppException {
  return new AppException(ErrorCode.NOT_FOUND, 'Không tìm thấy người dùng');
}

function invalid(details: ErrorDetail[]): AppException {
  return new AppException(ErrorCode.VALIDATION_ERROR, undefined, details);
}

function rule(message: string): AppException {
  return new AppException(ErrorCode.BUSINESS_RULE_VIOLATION, message);
}
