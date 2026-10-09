import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { AuditService } from '../audit/audit.service.js';
import { COMPANY_ADMIN_ROLE } from '../auth/default-roles.js';
import { exceedingGrants, type PermissionGrant } from '../auth/permission-grant.js';
import { PermissionService, type UserAccess } from '../auth/permission.service.js';
import { AppException, type ErrorDetail } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { assertTenant } from '../database/tenant.repository.js';
import type { Actor } from '../properties/properties.service.js';
import type { CreateRoleDto, RolePermissionDto, UpdateRoleDto } from './dto/role.dto.js';

export interface RoleSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  /** Vai trò "Quản trị công ty": quyền bị khoá, chỉ đổi được tên và mô tả. */
  permissionsLocked: boolean;
  userCount: number;
  permissionCount: number;
}

export interface RoleDetail extends RoleSummary {
  permissions: PermissionGrant[];
}

/** Một quyền trong danh mục (không gồm quyền nền tảng). */
export interface PermissionInfo {
  code: string;
  module: string;
  description: string;
}

interface RoleRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  user_count: number;
  permission_count: number;
}

function toSummary(row: RoleRow): RoleSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    isSystem: row.is_system,
    permissionsLocked: row.is_system && row.code === COMPANY_ADMIN_ROLE,
    userCount: row.user_count,
    permissionCount: row.permission_count,
  };
}

/** Dạng "code:SCOPE" để ghi nhật ký thay đổi quyền gọn và so sánh được. */
const grantKeys = (grants: readonly PermissionGrant[]): string[] =>
  grants.map((grant) => `${grant.code}:${grant.scope}`).sort();

/**
 * Quản lý vai trò của công ty (TASK-104, phase0/01-PRD.md US-04, phase0/04-RBAC.md). Cần `admin.manage`.
 * - Không gán quyền nền tảng; không cho role quyền vượt quyền của người sửa (chặn leo thang).
 * - Role mặc định không xoá được; quyền của COMPANY_ADMIN bị khoá (Huy Lê chọn 2026-10-09) để công ty
 *   không tự khoá mình khỏi trang quản trị.
 * - Role đang có người dùng không xoá được: chuyển họ sang role khác trước.
 * - Đổi quyền của role xoá cache quyền của mọi user để có hiệu lực ngay.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly permissions: PermissionService,
  ) {}

  async list(actor: Actor): Promise<RoleSummary[]> {
    assertTenant(actor.tenantId);
    const rows = (await this.dataSource.query(
      `${this.selectRoles()} WHERE r.tenant_id = $1 AND r.deleted_at IS NULL
        ORDER BY r.is_system DESC, r.name`,
      [actor.tenantId],
    )) as RoleRow[];
    return rows.map(toSummary);
  }

  async catalog(): Promise<PermissionInfo[]> {
    return this.dataSource.query(
      `SELECT code, module, description FROM permissions WHERE is_platform = false
        ORDER BY module, code`,
    );
  }

  async findOne(actor: Actor, id: string): Promise<RoleDetail> {
    const summary = await this.summary(actor, id);
    const permissions = (await this.dataSource.query(
      `SELECT p.code, rp.scope
         FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = $1
        ORDER BY p.code`,
      [id],
    )) as PermissionGrant[];
    return { ...summary, permissions };
  }

  async create(actor: Actor, dto: CreateRoleDto, access: UserAccess): Promise<RoleDetail> {
    assertTenant(actor.tenantId);
    const permissionIds = await this.checkGrants(dto.permissions, access);
    const existing: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM roles WHERE tenant_id = $1 AND code = $2 AND deleted_at IS NULL`,
      [actor.tenantId, dto.code],
    );
    if (existing.length > 0) {
      throw new AppException(ErrorCode.CONFLICT, 'Mã vai trò đã tồn tại', [
        { field: 'code', message: 'Mã vai trò đã tồn tại' },
      ]);
    }

    const id = await this.dataSource.transaction(async (manager) => {
      const [row] = (await manager.query(
        `INSERT INTO roles (tenant_id, code, name, description) VALUES ($1, $2, $3, $4) RETURNING id`,
        [actor.tenantId, dto.code, dto.name, dto.description ?? null],
      )) as { id: string }[];
      if (!row) {
        throw new Error('INSERT roles không trả về id');
      }
      await this.setGrants(manager, row.id, dto.permissions, permissionIds);
      await this.audit.record(manager, {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'role.create',
        entityType: 'role',
        entityId: row.id,
        changes: {
          code: [null, dto.code],
          name: [null, dto.name],
          permissions: [null, grantKeys(dto.permissions)],
        },
      });
      return row.id;
    });
    return this.findOne(actor, id);
  }

  async update(
    actor: Actor,
    id: string,
    dto: UpdateRoleDto,
    access: UserAccess,
  ): Promise<RoleDetail> {
    const current = await this.findOne(actor, id);
    let permissionIds: Map<string, string> | null = null;
    const permissionsChanged =
      dto.permissions !== undefined &&
      grantKeys(dto.permissions).join() !== grantKeys(current.permissions).join();
    if (permissionsChanged && dto.permissions) {
      if (current.permissionsLocked) {
        throw rule('Không thể sửa quyền của vai trò Quản trị công ty');
      }
      permissionIds = await this.checkGrants(dto.permissions, access);
    }

    await this.dataSource.transaction(async (manager) => {
      const changes: Record<string, [unknown, unknown]> = {};
      if (dto.name !== undefined && dto.name !== current.name) {
        changes['name'] = [current.name, dto.name];
      }
      if (dto.description !== undefined && dto.description !== current.description) {
        changes['description'] = [current.description, dto.description];
      }
      if (changes['name'] || changes['description']) {
        await manager.query(
          `UPDATE roles SET name = $3, description = $4 WHERE id = $1 AND tenant_id = $2`,
          [
            id,
            actor.tenantId,
            dto.name ?? current.name,
            dto.description === undefined ? current.description : dto.description,
          ],
        );
      }
      if (permissionIds && dto.permissions) {
        await manager.query(`DELETE FROM role_permissions WHERE role_id = $1`, [id]);
        await this.setGrants(manager, id, dto.permissions, permissionIds);
        changes['permissions'] = [grantKeys(current.permissions), grantKeys(dto.permissions)];
      }
      if (Object.keys(changes).length > 0) {
        await this.audit.record(manager, {
          tenantId: actor.tenantId,
          userId: actor.userId,
          action: 'role.update',
          entityType: 'role',
          entityId: id,
          changes,
        });
      }
    });
    if (permissionIds) {
      this.permissions.invalidate();
    }
    return this.findOne(actor, id);
  }

  async remove(actor: Actor, id: string): Promise<void> {
    const current = await this.summary(actor, id);
    if (current.isSystem) {
      throw rule('Không thể xoá vai trò mặc định');
    }
    await this.dataSource.transaction(async (manager) => {
      // Khoá role để không ai gán thêm người dùng giữa lúc kiểm và lúc xoá.
      await manager.query(`SELECT 1 FROM roles WHERE id = $1 FOR UPDATE`, [id]);
      const [assigned] = (await manager.query(
        `SELECT count(*)::int AS count
           FROM user_roles ur JOIN users u ON u.id = ur.user_id AND u.deleted_at IS NULL
          WHERE ur.role_id = $1`,
        [id],
      )) as { count: number }[];
      if ((assigned?.count ?? 0) > 0) {
        throw rule(
          `Còn ${assigned?.count} người dùng có vai trò này, hãy chuyển họ sang vai trò khác trước`,
        );
      }
      await manager.query(`DELETE FROM user_roles WHERE role_id = $1`, [id]);
      await manager.query(`UPDATE roles SET deleted_at = now() WHERE id = $1 AND tenant_id = $2`, [
        id,
        actor.tenantId,
      ]);
      await this.audit.record(manager, {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'role.delete',
        entityType: 'role',
        entityId: id,
        changes: { code: [current.code, null], name: [current.name, null] },
      });
    });
    this.permissions.invalidate();
  }

  private selectRoles(): string {
    return `
      SELECT r.id, r.code, r.name, r.description, r.is_system,
             (SELECT count(*)::int FROM user_roles ur JOIN users u ON u.id = ur.user_id
               WHERE ur.role_id = r.id AND u.deleted_at IS NULL) AS user_count,
             (SELECT count(*)::int FROM role_permissions rp WHERE rp.role_id = r.id) AS permission_count
        FROM roles r`;
  }

  /** Role của công ty, chưa xoá; không có → 404. */
  private async summary(actor: Actor, id: string): Promise<RoleSummary> {
    assertTenant(actor.tenantId);
    const [row] = (await this.dataSource.query(
      `${this.selectRoles()} WHERE r.id = $1 AND r.tenant_id = $2 AND r.deleted_at IS NULL`,
      [id, actor.tenantId],
    )) as RoleRow[];
    if (!row) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Không tìm thấy vai trò');
    }
    return toSummary(row);
  }

  /**
   * Quyền phải có trong danh mục, không phải quyền nền tảng, không trùng (sai → 400) và không vượt quyền của
   * người thao tác (→ 403). Trả map code → permission id.
   */
  private async checkGrants(
    grants: readonly RolePermissionDto[],
    access: UserAccess,
  ): Promise<Map<string, string>> {
    const codes = grants.map((grant) => grant.code);
    const details: ErrorDetail[] = [];
    if (new Set(codes).size !== codes.length) {
      details.push({ field: 'permissions', message: 'Một quyền bị chọn nhiều lần' });
    }
    const rows = (await this.dataSource.query(
      `SELECT id, code FROM permissions WHERE code = ANY($1::text[]) AND is_platform = false`,
      [codes],
    )) as { id: string; code: string }[];
    const ids = new Map(rows.map((row) => [row.code, row.id]));
    const unknown = codes.filter((code) => !ids.has(code));
    if (unknown.length > 0) {
      details.push({ field: 'permissions', message: `Quyền không hợp lệ: ${unknown.join(', ')}` });
    }
    if (details.length > 0) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, undefined, details);
    }
    if (exceedingGrants(grants, access).length > 0) {
      throw new AppException(
        ErrorCode.FORBIDDEN,
        'Không thể cấp cho vai trò quyền vượt quá quyền của bạn',
      );
    }
    return ids;
  }

  private async setGrants(
    manager: EntityManager,
    roleId: string,
    grants: readonly PermissionGrant[],
    permissionIds: Map<string, string>,
  ): Promise<void> {
    if (grants.length === 0) {
      return;
    }
    await manager.query(
      `INSERT INTO role_permissions (role_id, permission_id, scope)
       SELECT $1, unnest($2::uuid[]), unnest($3::text[])`,
      [
        roleId,
        grants.map((grant) => permissionIds.get(grant.code)),
        grants.map((grant) => grant.scope),
      ],
    );
  }
}

function rule(message: string): AppException {
  return new AppException(ErrorCode.BUSINESS_RULE_VIOLATION, message);
}
