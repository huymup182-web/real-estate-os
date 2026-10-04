import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { AppException, type ErrorDetail } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { toCompanySlug, withRandomSuffix } from './company-slug.js';
import { COMPANY_ADMIN_ROLE, DEFAULT_ROLE_MATRIX, DEFAULT_ROLES } from './default-roles.js';
import type { RegisterDto } from './dto/register.dto.js';
import { hashPassword } from './password.js';

export interface RegisterResult {
  user: { id: string; fullName: string; email: string | null; phone: string | null };
  company: { id: string; name: string; slug: string };
}

/** Số lần thử slug ngẫu nhiên khi slug gốc đã bị dùng. */
const SLUG_ATTEMPTS = 5;

async function insertReturningId(
  manager: EntityManager,
  sql: string,
  params: unknown[],
): Promise<string> {
  const rows: { id: string }[] = await manager.query(sql, params);
  const id = rows[0]?.id;
  if (!id) {
    throw new Error('INSERT không trả về id');
  }
  return id;
}

@Injectable()
export class AuthService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Đăng ký công khai: trong một transaction tạo công ty (ACTIVE), 6 role mặc định kèm quyền,
   * tài khoản người đăng ký và gán role COMPANY_ADMIN. Lỗi ở bất kỳ bước nào thì không tạo gì.
   */
  async register(dto: RegisterDto): Promise<RegisterResult> {
    await this.assertContactAvailable(dto);
    const passwordHash = await hashPassword(dto.password);

    return this.dataSource.transaction(async (manager) => {
      const slug = await this.availableSlug(manager, toCompanySlug(dto.companyName));
      const companyId = await insertReturningId(
        manager,
        `INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id`,
        [dto.companyName, slug],
      );
      const adminRoleId = await this.createDefaultRoles(manager, companyId);
      const userId = await insertReturningId(
        manager,
        `INSERT INTO users (tenant_id, email, phone, password_hash, full_name)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [companyId, dto.email ?? null, dto.phone ?? null, passwordHash, dto.fullName],
      );
      await manager.query(
        `INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)`,
        [userId, adminRoleId, companyId],
      );
      return {
        user: {
          id: userId,
          fullName: dto.fullName,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
        },
        company: { id: companyId, name: dto.companyName, slug },
      };
    });
  }

  /** Email/SĐT là duy nhất toàn hệ thống; báo rõ trường bị trùng. */
  private async assertContactAvailable(dto: RegisterDto): Promise<void> {
    const details: ErrorDetail[] = [];
    if (dto.email) {
      const rows: unknown[] = await this.dataSource.query(
        `SELECT 1 FROM users WHERE email = $1 AND deleted_at IS NULL`,
        [dto.email],
      );
      if (rows.length > 0) {
        details.push({ field: 'email', message: 'Email đã được sử dụng' });
      }
    }
    if (dto.phone) {
      const rows: unknown[] = await this.dataSource.query(
        `SELECT 1 FROM users WHERE phone = $1 AND deleted_at IS NULL`,
        [dto.phone],
      );
      if (rows.length > 0) {
        details.push({ field: 'phone', message: 'Số điện thoại đã được sử dụng' });
      }
    }
    if (details.length > 0) {
      throw new AppException(ErrorCode.CONFLICT, 'Tài khoản đã tồn tại', details);
    }
  }

  private async availableSlug(manager: EntityManager, base: string): Promise<string> {
    const candidates = [
      base,
      ...Array.from({ length: SLUG_ATTEMPTS }, () => withRandomSuffix(base)),
    ];
    for (const slug of candidates) {
      const rows: unknown[] = await manager.query(`SELECT 1 FROM companies WHERE slug = $1`, [
        slug,
      ]);
      if (rows.length === 0) {
        return slug;
      }
    }
    throw new Error('Không tìm được slug công ty còn trống');
  }

  /** Tạo 6 role mặc định cho công ty mới; trả về id role COMPANY_ADMIN. */
  private async createDefaultRoles(manager: EntityManager, companyId: string): Promise<string> {
    const roleIds: string[] = [];
    for (const [code, name] of DEFAULT_ROLES) {
      roleIds.push(
        await insertReturningId(
          manager,
          `INSERT INTO roles (tenant_id, code, name, is_system) VALUES ($1, $2, $3, true) RETURNING id`,
          [companyId, code, name],
        ),
      );
    }
    const permissions: { id: string; code: string }[] = await manager.query(
      `SELECT id, code FROM permissions WHERE is_platform = false`,
    );
    const permissionIds = new Map(permissions.map((p) => [p.code, p.id]));
    for (const [code, scopes] of Object.entries(DEFAULT_ROLE_MATRIX)) {
      const permissionId = permissionIds.get(code);
      if (!permissionId) {
        throw new Error(`Thiếu permission ${code}`);
      }
      for (const [index, scope] of scopes.entries()) {
        if (scope) {
          await manager.query(
            `INSERT INTO role_permissions (role_id, permission_id, scope) VALUES ($1, $2, $3)`,
            [roleIds[index], permissionId, scope],
          );
        }
      }
    }
    const adminIndex = DEFAULT_ROLES.findIndex(([code]) => code === COMPANY_ADMIN_ROLE);
    const adminRoleId = roleIds[adminIndex];
    if (!adminRoleId) {
      throw new Error('Thiếu role COMPANY_ADMIN');
    }
    return adminRoleId;
  }
}
