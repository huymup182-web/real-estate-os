import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { AuditService } from '../audit/audit.service.js';
import type { PermissionScope, UserAccess } from '../auth/permission.service.js';
import { AppException, type ErrorDetail } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { assertTenant } from '../database/tenant.repository.js';
import type { Actor } from '../properties/properties.service.js';
import type { CreateTeamDto, TeamListQueryDto, UpdateTeamDto } from './dto/team.dto.js';

/** `GET /teams` (TASK-106). */
export interface TeamSummary {
  id: string;
  name: string;
  department: { id: string; name: string };
  leader: { id: string; fullName: string } | null;
  memberCount: number;
}

export interface TeamMember {
  id: string;
  fullName: string;
  email: string | null;
  status: string;
}

export interface TeamDetail extends TeamSummary {
  members: TeamMember[];
  /** Người gọi sửa, xoá được team này không (theo phạm vi `team.manage`). */
  canManage: boolean;
}

/** `GET /teams/options`: phòng ban tạo team được và người dùng chọn làm trưởng nhóm/thành viên được. */
export interface TeamOptions {
  departments: { id: string; name: string }[];
  users: { id: string; fullName: string; email: string | null; departmentId: string }[];
}

interface TeamRow {
  id: string;
  name: string;
  department_id: string;
  department_name: string;
  leader_id: string | null;
  leader_name: string | null;
  member_count: number;
}

const SELECT_TEAMS = `
  SELECT t.id, t.name, d.id AS department_id, d.name AS department_name,
         l.id AS leader_id, l.full_name AS leader_name,
         (SELECT count(*)::int FROM team_members m JOIN users mu ON mu.id = m.user_id
           WHERE m.team_id = t.id AND mu.deleted_at IS NULL) AS member_count
    FROM teams t
    JOIN departments d ON d.id = t.department_id
    LEFT JOIN users l ON l.id = t.leader_id AND l.deleted_at IS NULL`;

function toSummary(row: TeamRow): TeamSummary {
  return {
    id: row.id,
    name: row.name,
    department: { id: row.department_id, name: row.department_name },
    leader:
      row.leader_id && row.leader_name ? { id: row.leader_id, fullName: row.leader_name } : null,
    memberCount: row.member_count,
  };
}

/**
 * Điều kiện SQL "team `t` nằm trong phạm vi `scope` của user `$userParam`" (phase0/04-RBAC.md mục 2):
 * - OWN, TEAM: team mình làm trưởng nhóm hoặc là thành viên.
 * - DEPARTMENT: thêm mọi team thuộc phòng ban của mình.
 * - COMPANY: mọi team của công ty (điều kiện tenant gắn riêng).
 * `userParam` là tham số vị trí (vd `$2`) chứa id người gọi.
 */
function teamScope(scope: PermissionScope, userParam: string): string {
  const mine = `(t.leader_id = ${userParam} OR EXISTS (
    SELECT 1 FROM team_members sm WHERE sm.team_id = t.id AND sm.user_id = ${userParam}))`;
  switch (scope) {
    case 'OWN':
    case 'TEAM':
      return mine;
    case 'DEPARTMENT':
      return `(${mine} OR t.department_id IN (
        SELECT department_id FROM users WHERE id = ${userParam} AND department_id IS NOT NULL))`;
    case 'COMPANY':
    case 'PLATFORM':
      // Luôn đúng, nhưng vẫn nhắc tới tham số để Postgres biết kiểu của nó (câu lệnh truyền cố định).
      return `${userParam}::uuid IS NOT NULL`;
  }
}

const sortedIds = (ids: readonly string[]): string[] => [...ids].sort();

/**
 * Team và thành viên (TASK-106, phase0/01-PRD.md US-03). Xem theo `team.view`, sửa theo `team.manage`.
 * - Team thuộc một phòng ban. Trưởng nhóm và thành viên phải cùng phòng ban với team (Huy Lê chọn
 *   2026-10-09) để trưởng nhóm không thấy dữ liệu của phòng ban khác qua phạm vi TEAM.
 * - Người mới thêm vào team (trưởng nhóm, thành viên) phải đang hoạt động.
 * - Tạo team hoặc chuyển team sang phòng ban khác: phòng ban phải nằm trong phạm vi `team.manage`
 *   (COMPANY: mọi phòng ban, DEPARTMENT: phòng ban của mình).
 * - Xoá là xoá mềm; dòng thành viên được giữ lại làm lịch sử, mọi truy vấn phạm vi đã bỏ qua team đã xoá.
 */
@Injectable()
export class TeamsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: Actor,
    scope: PermissionScope,
    query: TeamListQueryDto,
  ): Promise<TeamSummary[]> {
    assertTenant(actor.tenantId);
    const rows = (await this.dataSource.query(
      `${SELECT_TEAMS}
        WHERE t.tenant_id = $1 AND t.deleted_at IS NULL AND ${teamScope(scope, '$2')}
          AND ($3::uuid IS NULL OR t.department_id = $3::uuid)
        ORDER BY d.name, t.name, t.id`,
      [actor.tenantId, actor.userId, query.departmentId ?? null],
    )) as TeamRow[];
    return rows.map(toSummary);
  }

  async options(actor: Actor, access: UserAccess): Promise<TeamOptions> {
    const departments = await this.manageableDepartments(actor, access);
    const users = (await this.dataSource.query(
      `SELECT id, full_name AS "fullName", email, department_id AS "departmentId" FROM users
        WHERE tenant_id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL
          AND department_id = ANY($2::uuid[])
        ORDER BY full_name, id`,
      [actor.tenantId, departments.map((department) => department.id)],
    )) as TeamOptions['users'];
    return { departments, users };
  }

  async findOne(actor: Actor, id: string, access: UserAccess): Promise<TeamDetail> {
    const summary = await this.visible(actor, id, access);
    const members = (await this.dataSource.query(
      `SELECT u.id, u.full_name AS "fullName", u.email, u.status
         FROM team_members m JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
        WHERE m.team_id = $1
        ORDER BY u.full_name, u.id`,
      [id],
    )) as TeamMember[];
    return { ...summary, members, canManage: await this.manages(actor, id, access) };
  }

  async create(actor: Actor, dto: CreateTeamDto, access: UserAccess): Promise<TeamDetail> {
    assertTenant(actor.tenantId);
    await this.assertDepartment(actor, dto.departmentId, access);
    const leaderId = dto.leaderId ?? null;
    const memberIds = dto.memberIds ?? [];
    await this.assertName(actor, dto.departmentId, dto.name, null);
    await this.assertPeople(actor, dto.departmentId, leaderId, memberIds, {
      leader: leaderId,
      members: memberIds,
    });

    const id = await this.dataSource.transaction(async (manager) => {
      const [row] = (await manager.query(
        `INSERT INTO teams (tenant_id, department_id, name, leader_id) VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [actor.tenantId, dto.departmentId, dto.name, leaderId],
      )) as { id: string }[];
      if (!row) {
        throw new Error('INSERT teams không trả về id');
      }
      await this.addMembers(manager, actor, row.id, memberIds);
      await this.record(manager, actor, 'team.create', row.id, {
        name: [null, dto.name],
        departmentId: [null, dto.departmentId],
        leaderId: [null, leaderId],
        memberIds: [null, sortedIds(memberIds)],
      });
      return row.id;
    });
    return this.findOne(actor, id, access);
  }

  async update(
    actor: Actor,
    id: string,
    dto: UpdateTeamDto,
    access: UserAccess,
  ): Promise<TeamDetail> {
    const current = await this.findOne(actor, id, access);
    if (!current.canManage) {
      throw forbidden();
    }
    const departmentId = dto.departmentId ?? current.department.id;
    const departmentChanged = departmentId !== current.department.id;
    if (departmentChanged) {
      await this.assertDepartment(actor, departmentId, access);
    }
    const name = dto.name ?? current.name;
    if (name !== current.name || departmentChanged) {
      await this.assertName(actor, departmentId, name, id);
    }
    const currentLeader = current.leader?.id ?? null;
    const currentMembers = current.members.map((member) => member.id);
    const leaderId = dto.leaderId === undefined ? currentLeader : dto.leaderId;
    const memberIds = dto.memberIds ?? currentMembers;
    await this.assertPeople(actor, departmentId, leaderId, memberIds, {
      leader: leaderId !== currentLeader ? leaderId : null,
      members: memberIds.filter((memberId) => !currentMembers.includes(memberId)),
    });

    const changes: Record<string, [unknown, unknown]> = {};
    if (name !== current.name) {
      changes['name'] = [current.name, name];
    }
    if (departmentChanged) {
      changes['departmentId'] = [current.department.id, departmentId];
    }
    if (leaderId !== currentLeader) {
      changes['leaderId'] = [currentLeader, leaderId];
    }
    const membersChanged = sortedIds(memberIds).join() !== sortedIds(currentMembers).join();
    if (membersChanged) {
      changes['memberIds'] = [sortedIds(currentMembers), sortedIds(memberIds)];
    }
    if (Object.keys(changes).length === 0) {
      return current;
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE teams SET name = $3, department_id = $4, leader_id = $5
          WHERE id = $1 AND tenant_id = $2`,
        [id, actor.tenantId, name, departmentId, leaderId],
      );
      if (membersChanged) {
        await manager.query(
          `DELETE FROM team_members WHERE team_id = $1 AND NOT (user_id = ANY($2::uuid[]))`,
          [id, memberIds],
        );
        await this.addMembers(manager, actor, id, memberIds);
      }
      await this.record(manager, actor, 'team.update', id, changes);
    });
    return this.findOne(actor, id, access);
  }

  async remove(actor: Actor, id: string, access: UserAccess): Promise<void> {
    const current = await this.findOne(actor, id, access);
    if (!current.canManage) {
      throw forbidden();
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE teams SET deleted_at = now() WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [id, actor.tenantId],
      );
      await this.record(manager, actor, 'team.delete', id, {
        name: [current.name, null],
        memberIds: [sortedIds(current.members.map((member) => member.id)), null],
      });
    });
  }

  /** Team của công ty, chưa xoá, trong phạm vi `team.view`; không thì 404. */
  private async visible(actor: Actor, id: string, access: UserAccess): Promise<TeamSummary> {
    assertTenant(actor.tenantId);
    const scope = access.permissions['team.view'];
    const [row] = scope
      ? ((await this.dataSource.query(
          `${SELECT_TEAMS}
            WHERE t.id = $1 AND t.tenant_id = $2 AND t.deleted_at IS NULL AND ${teamScope(scope, '$3')}`,
          [id, actor.tenantId, actor.userId],
        )) as TeamRow[])
      : [];
    if (!row) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Không tìm thấy team');
    }
    return toSummary(row);
  }

  private async manages(actor: Actor, id: string, access: UserAccess): Promise<boolean> {
    const scope = access.permissions['team.manage'];
    if (!scope) {
      return false;
    }
    const rows: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM teams t WHERE t.id = $1 AND t.tenant_id = $2 AND ${teamScope(scope, '$3')}`,
      [id, actor.tenantId, actor.userId],
    );
    return rows.length > 0;
  }

  /** Phòng ban tạo/chuyển team vào được: COMPANY mọi phòng ban, DEPARTMENT phòng ban của mình. */
  private async manageableDepartments(
    actor: Actor,
    access: UserAccess,
  ): Promise<{ id: string; name: string }[]> {
    assertTenant(actor.tenantId);
    const scope = access.permissions['team.manage'];
    if (scope !== 'COMPANY' && scope !== 'PLATFORM' && scope !== 'DEPARTMENT') {
      return [];
    }
    return this.dataSource.query(
      `SELECT d.id, d.name FROM departments d
        WHERE d.tenant_id = $1 AND d.deleted_at IS NULL
          AND ($3::boolean OR d.id IN (SELECT department_id FROM users WHERE id = $2))
        ORDER BY d.name, d.id`,
      [actor.tenantId, actor.userId, scope !== 'DEPARTMENT'],
    );
  }

  private async assertDepartment(
    actor: Actor,
    departmentId: string,
    access: UserAccess,
  ): Promise<void> {
    const departments = await this.manageableDepartments(actor, access);
    if (departments.some((department) => department.id === departmentId)) {
      return;
    }
    const exists: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM departments WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [departmentId, actor.tenantId],
    );
    if (exists.length === 0) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, undefined, [
        { field: 'departmentId', message: 'Phòng ban không tồn tại' },
      ]);
    }
    throw new AppException(ErrorCode.FORBIDDEN, 'Không có quyền quản lý team của phòng ban này');
  }

  private async assertName(
    actor: Actor,
    departmentId: string,
    name: string,
    exceptId: string | null,
  ): Promise<void> {
    const rows: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM teams
        WHERE tenant_id = $1 AND department_id = $2 AND name = $3 AND deleted_at IS NULL
          AND ($4::uuid IS NULL OR id <> $4::uuid)`,
      [actor.tenantId, departmentId, name, exceptId],
    );
    if (rows.length > 0) {
      throw new AppException(ErrorCode.CONFLICT, 'Phòng ban đã có team trùng tên', [
        { field: 'name', message: 'Phòng ban đã có team trùng tên' },
      ]);
    }
  }

  /**
   * Trưởng nhóm và mọi thành viên phải là người dùng của công ty, thuộc phòng ban `departmentId`;
   * người mới thêm (`added`) còn phải đang hoạt động. Sai → 400 theo trường.
   */
  private async assertPeople(
    actor: Actor,
    departmentId: string,
    leaderId: string | null,
    memberIds: readonly string[],
    added: { leader: string | null; members: readonly string[] },
  ): Promise<void> {
    const ids = [...new Set([...(leaderId ? [leaderId] : []), ...memberIds])];
    if (ids.length === 0) {
      return;
    }
    const rows = (await this.dataSource.query(
      `SELECT id, status, department_id FROM users
        WHERE id = ANY($1::uuid[]) AND tenant_id = $2 AND deleted_at IS NULL`,
      [ids, actor.tenantId],
    )) as { id: string; status: string; department_id: string | null }[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const valid = (id: string, isNew: boolean): boolean => {
      const user = byId.get(id);
      return (
        user !== undefined &&
        user.department_id === departmentId &&
        (!isNew || user.status === 'ACTIVE')
      );
    };
    const details: ErrorDetail[] = [];
    if (leaderId && !valid(leaderId, added.leader === leaderId)) {
      details.push({
        field: 'leaderId',
        message: 'Trưởng nhóm phải là người dùng đang hoạt động thuộc phòng ban của team',
      });
    }
    const invalid = memberIds.filter((id) => !valid(id, added.members.includes(id)));
    if (invalid.length > 0) {
      details.push({
        field: 'memberIds',
        message: `${invalid.length} thành viên không thuộc phòng ban của team hoặc không còn hoạt động`,
      });
    }
    if (details.length > 0) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, undefined, details);
    }
  }

  private async addMembers(
    manager: EntityManager,
    actor: Actor,
    teamId: string,
    memberIds: readonly string[],
  ): Promise<void> {
    if (memberIds.length === 0) {
      return;
    }
    await manager.query(
      `INSERT INTO team_members (tenant_id, team_id, user_id)
       SELECT $1, $2, unnest($3::uuid[])
       ON CONFLICT (team_id, user_id) DO NOTHING`,
      [actor.tenantId, teamId, memberIds],
    );
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
      entityType: 'team',
      entityId,
      changes,
    });
  }
}

function forbidden(): AppException {
  return new AppException(ErrorCode.FORBIDDEN, 'Không có quyền quản lý team này');
}
