import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { assertTenant } from '../database/tenant.repository.js';
import type { Actor } from '../properties/properties.service.js';
import type { CreateDepartmentDto, UpdateDepartmentDto } from './dto/company.dto.js';

/** `GET /departments` (TASK-105). */
export interface Department {
  id: string;
  name: string;
  manager: { id: string; fullName: string } | null;
  userCount: number;
  teamCount: number;
}

/** `GET /departments/manager-options`. */
export interface ManagerOption {
  id: string;
  fullName: string;
  email: string | null;
}

interface DepartmentRow {
  id: string;
  name: string;
  manager_id: string | null;
  manager_name: string | null;
  user_count: number;
  team_count: number;
}

const SELECT_DEPARTMENTS = `
  SELECT d.id, d.name, m.id AS manager_id, m.full_name AS manager_name,
         (SELECT count(*)::int FROM users u
           WHERE u.department_id = d.id AND u.deleted_at IS NULL) AS user_count,
         (SELECT count(*)::int FROM teams t
           WHERE t.department_id = d.id AND t.deleted_at IS NULL) AS team_count
    FROM departments d
    LEFT JOIN users m ON m.id = d.manager_id AND m.deleted_at IS NULL`;

function toDepartment(row: DepartmentRow): Department {
  return {
    id: row.id,
    name: row.name,
    manager:
      row.manager_id && row.manager_name
        ? { id: row.manager_id, fullName: row.manager_name }
        : null,
    userCount: row.user_count,
    teamCount: row.team_count,
  };
}

/**
 * Phòng ban của công ty (TASK-105). Cần `admin.manage`.
 * - Tên không trùng trong công ty (→ 409); trưởng phòng là người dùng đang hoạt động của công ty (sai → 400).
 * - Chỉ xoá (mềm) được phòng ban không còn người dùng hay team (→ 422), để không ai mất phòng ban âm thầm.
 */
@Injectable()
export class DepartmentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async list(actor: Actor): Promise<Department[]> {
    assertTenant(actor.tenantId);
    const rows = (await this.dataSource.query(
      `${SELECT_DEPARTMENTS} WHERE d.tenant_id = $1 AND d.deleted_at IS NULL ORDER BY d.name`,
      [actor.tenantId],
    )) as DepartmentRow[];
    return rows.map(toDepartment);
  }

  /** Người dùng đang hoạt động của công ty, để chọn trưởng phòng. */
  async managerOptions(actor: Actor): Promise<ManagerOption[]> {
    assertTenant(actor.tenantId);
    return this.dataSource.query(
      `SELECT id, full_name AS "fullName", email FROM users
        WHERE tenant_id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL
        ORDER BY full_name, id`,
      [actor.tenantId],
    );
  }

  async findOne(actor: Actor, id: string): Promise<Department> {
    assertTenant(actor.tenantId);
    const [row] = (await this.dataSource.query(
      `${SELECT_DEPARTMENTS} WHERE d.id = $1 AND d.tenant_id = $2 AND d.deleted_at IS NULL`,
      [id, actor.tenantId],
    )) as DepartmentRow[];
    if (!row) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Không tìm thấy phòng ban');
    }
    return toDepartment(row);
  }

  async create(actor: Actor, dto: CreateDepartmentDto): Promise<Department> {
    assertTenant(actor.tenantId);
    const managerId = dto.managerId ?? null;
    await this.assertName(actor, dto.name, null);
    await this.assertManager(actor, managerId);
    const id = await this.dataSource.transaction(async (manager) => {
      const [row] = (await manager.query(
        `INSERT INTO departments (tenant_id, name, manager_id) VALUES ($1, $2, $3) RETURNING id`,
        [actor.tenantId, dto.name, managerId],
      )) as { id: string }[];
      if (!row) {
        throw new Error('INSERT departments không trả về id');
      }
      await this.record(manager, actor, 'department.create', row.id, {
        name: [null, dto.name],
        managerId: [null, managerId],
      });
      return row.id;
    });
    return this.findOne(actor, id);
  }

  async update(actor: Actor, id: string, dto: UpdateDepartmentDto): Promise<Department> {
    const current = await this.findOne(actor, id);
    const changes: Record<string, [unknown, unknown]> = {};
    if (dto.name !== undefined && dto.name !== current.name) {
      await this.assertName(actor, dto.name, id);
      changes['name'] = [current.name, dto.name];
    }
    const currentManager = current.manager?.id ?? null;
    if (dto.managerId !== undefined && dto.managerId !== currentManager) {
      await this.assertManager(actor, dto.managerId);
      changes['managerId'] = [currentManager, dto.managerId];
    }
    if (Object.keys(changes).length === 0) {
      return current;
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE departments SET name = $3, manager_id = $4 WHERE id = $1 AND tenant_id = $2`,
        [
          id,
          actor.tenantId,
          dto.name ?? current.name,
          dto.managerId === undefined ? currentManager : dto.managerId,
        ],
      );
      await this.record(manager, actor, 'department.update', id, changes);
    });
    return this.findOne(actor, id);
  }

  async remove(actor: Actor, id: string): Promise<void> {
    const current = await this.findOne(actor, id);
    await this.dataSource.transaction(async (manager) => {
      // Khoá phòng ban: gán user/team mới vào phòng ban (khoá ngoại) phải chờ tới khi xoá xong.
      await manager.query(`SELECT 1 FROM departments WHERE id = $1 FOR UPDATE`, [id]);
      const [usage] = (await manager.query(
        `SELECT (SELECT count(*)::int FROM users
                  WHERE department_id = $1 AND deleted_at IS NULL) AS users,
                (SELECT count(*)::int FROM teams
                  WHERE department_id = $1 AND deleted_at IS NULL) AS teams`,
        [id],
      )) as { users: number; teams: number }[];
      if ((usage?.users ?? 0) > 0 || (usage?.teams ?? 0) > 0) {
        throw new AppException(
          ErrorCode.BUSINESS_RULE_VIOLATION,
          `Phòng ban còn ${usage?.users ?? 0} người dùng và ${usage?.teams ?? 0} team, hãy chuyển họ sang phòng ban khác trước`,
        );
      }
      await manager.query(
        `UPDATE departments SET deleted_at = now() WHERE id = $1 AND tenant_id = $2`,
        [id, actor.tenantId],
      );
      await this.record(manager, actor, 'department.delete', id, {
        name: [current.name, null],
      });
    });
  }

  private async assertName(actor: Actor, name: string, exceptId: string | null): Promise<void> {
    const rows: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM departments
        WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL
          AND ($3::uuid IS NULL OR id <> $3::uuid)`,
      [actor.tenantId, name, exceptId],
    );
    if (rows.length > 0) {
      throw new AppException(ErrorCode.CONFLICT, 'Tên phòng ban đã tồn tại', [
        { field: 'name', message: 'Tên phòng ban đã tồn tại' },
      ]);
    }
  }

  private async assertManager(actor: Actor, managerId: string | null): Promise<void> {
    if (managerId === null) {
      return;
    }
    const rows: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM users
        WHERE id = $1 AND tenant_id = $2 AND status = 'ACTIVE' AND deleted_at IS NULL`,
      [managerId, actor.tenantId],
    );
    if (rows.length === 0) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, undefined, [
        {
          field: 'managerId',
          message: 'Trưởng phòng phải là người dùng đang hoạt động của công ty',
        },
      ]);
    }
  }

  private record(
    manager: EntityManager,
    actor: Actor,
    action: string,
    entityId: string,
    changes: Record<string, [unknown, unknown]>,
  ): Promise<void> {
    return this.audit.record(manager, {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action,
      entityType: 'department',
      entityId,
      changes,
    });
  }
}
