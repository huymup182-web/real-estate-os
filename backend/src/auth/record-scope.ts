import type { PermissionScope } from './permission.service.js';

/** Cột của bản ghi dùng để xét phạm vi: người phụ trách và người tạo. */
export interface ScopeColumns {
  agent: string;
  creator: string;
}

/**
 * Điều kiện SQL "bản ghi nằm trong phạm vi `scope` của user" (phase0/04-RBAC.md mục 2), dùng chung cho
 * mọi module. User truyền qua tham số đặt tên `:scopeUserId` của TypeORM query builder.
 * - OWN: mình phụ trách hoặc mình tạo.
 * - TEAM: OWN, hoặc người phụ trách là thành viên/trưởng nhóm của các team mình thuộc hoặc làm trưởng nhóm.
 * - DEPARTMENT: OWN, hoặc người phụ trách cùng phòng ban với mình (mình không có phòng ban → chỉ OWN).
 * - COMPANY, PLATFORM: mọi bản ghi (điều kiện tenant do TenantRepository gắn riêng).
 * Tên cột là hằng số trong code, không bao giờ lấy từ input.
 */
export function scopeCondition(scope: PermissionScope, columns: ScopeColumns): string {
  const own = `(${columns.agent} = :scopeUserId OR ${columns.creator} = :scopeUserId)`;
  switch (scope) {
    case 'OWN':
      return own;
    case 'TEAM':
      return `(${own} OR ${columns.agent} IN (
        WITH my_teams AS (
          SELECT t.id, t.leader_id FROM teams t
           WHERE t.deleted_at IS NULL
             AND (t.leader_id = :scopeUserId
                  OR EXISTS (SELECT 1 FROM team_members m
                              WHERE m.team_id = t.id AND m.user_id = :scopeUserId))
        )
        SELECT m.user_id FROM team_members m JOIN my_teams ON my_teams.id = m.team_id
        UNION
        SELECT leader_id FROM my_teams WHERE leader_id IS NOT NULL
      ))`;
    case 'DEPARTMENT':
      return `(${own} OR ${columns.agent} IN (
        SELECT colleague.id FROM users colleague
          JOIN users me ON me.id = :scopeUserId
         WHERE colleague.department_id = me.department_id
      ))`;
    case 'COMPANY':
    case 'PLATFORM':
      return 'TRUE';
  }
}
