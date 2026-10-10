import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, describeTable, insertRow, revertAll } from './helpers.ts';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$test$test';

describe('TASK-012: bảng teams và team_members', () => {
  let db: DataSource;
  let companyA: string;
  let companyB: string;
  let departmentA: string;
  let departmentB: string;
  let seq = 0;

  before(async () => {
    db = await createCleanTestDataSource();
    await db.runMigrations();
    companyA = String((await insertRow(db, 'companies', { name: 'A', slug: 'cong-ty-a' }))['id']);
    companyB = String((await insertRow(db, 'companies', { name: 'B', slug: 'cong-ty-b' }))['id']);
    departmentA = String(
      (await insertRow(db, 'departments', { tenant_id: companyA, name: 'Kinh doanh' }))['id'],
    );
    departmentB = String(
      (await insertRow(db, 'departments', { tenant_id: companyB, name: 'Kinh doanh' }))['id'],
    );
  });

  after(async () => {
    await db.destroy();
  });

  async function insertUser(tenantId: string): Promise<string> {
    seq += 1;
    const user = await insertRow(db, 'users', {
      tenant_id: tenantId,
      email: `user${seq}@example.com`,
      password_hash: HASH,
      full_name: 'Người dùng',
    });
    return String(user['id']);
  }

  async function insertTeam(values: Record<string, unknown>): Promise<string> {
    seq += 1;
    const team = await insertRow(db, 'teams', {
      tenant_id: companyA,
      department_id: departmentA,
      name: `Nhóm ${seq}`,
      ...values,
    });
    return String(team['id']);
  }

  function addMember(teamId: string, userId: string, tenantId = companyA): Promise<unknown> {
    return insertRow(db, 'team_members', { tenant_id: tenantId, team_id: teamId, user_id: userId });
  }

  it('teams và team_members có đủ cột đúng kiểu', async () => {
    assert.deepEqual(await describeTable(db, 'teams'), [
      ['id', 'uuid', 'NO'],
      ['tenant_id', 'uuid', 'NO'],
      ['department_id', 'uuid', 'NO'],
      ['name', 'character varying', 'NO'],
      ['leader_id', 'uuid', 'YES'],
      ['created_at', 'timestamp with time zone', 'NO'],
      ['updated_at', 'timestamp with time zone', 'NO'],
      ['deleted_at', 'timestamp with time zone', 'YES'],
    ]);
    assert.deepEqual(await describeTable(db, 'team_members'), [
      ['tenant_id', 'uuid', 'NO'],
      ['team_id', 'uuid', 'NO'],
      ['user_id', 'uuid', 'NO'],
      ['joined_at', 'timestamp with time zone', 'NO'],
    ]);
  });

  it('tên team không trùng trong một phòng ban, dùng lại được ở phòng ban khác và sau soft delete', async () => {
    const otherDepartment = String(
      (await insertRow(db, 'departments', { tenant_id: companyA, name: 'Kinh doanh 2' }))['id'],
    );
    const team = await insertTeam({ name: 'Nhóm Alpha' });
    await insertTeam({ department_id: otherDepartment, name: 'Nhóm Alpha' });
    await assert.rejects(
      insertTeam({ name: 'Nhóm Alpha' }),
      /uq_teams_tenant_id_department_id_name/,
    );
    await db.query('UPDATE teams SET deleted_at = now() WHERE id = $1', [team]);
    await insertTeam({ name: 'Nhóm Alpha' });
    await assert.rejects(insertTeam({ name: ' ' }), /ck_teams_name_not_blank/);
  });

  it('phòng ban và trưởng nhóm phải cùng công ty với team', async () => {
    await assert.rejects(insertTeam({ department_id: departmentB }), /fk_teams_department_id/);
    await insertTeam({ leader_id: await insertUser(companyA) });
    await assert.rejects(
      insertTeam({ leader_id: await insertUser(companyB) }),
      /fk_teams_leader_id/,
    );
  });

  it('user thuộc được nhiều team, không thêm trùng vào một team', async () => {
    const user = await insertUser(companyA);
    const team1 = await insertTeam({});
    const team2 = await insertTeam({});
    await addMember(team1, user);
    await addMember(team2, user);
    await assert.rejects(addMember(team1, user), /pk_team_members/);
  });

  it('không thêm được thành viên hoặc team của công ty khác', async () => {
    const teamA = await insertTeam({});
    const teamB = await insertTeam({ tenant_id: companyB, department_id: departmentB });
    const userA = await insertUser(companyA);
    const userB = await insertUser(companyB);
    await assert.rejects(addMember(teamA, userB), /fk_team_members_user_id/);
    await assert.rejects(addMember(teamB, userA), /fk_team_members_team_id/);
    await assert.rejects(addMember(teamA, userB, companyB), /fk_team_members_team_id/);
  });

  it('xoá team hoặc user thì xoá thành viên; không xoá được phòng ban còn team, user đang là trưởng nhóm', async () => {
    const leader = await insertUser(companyA);
    const member = await insertUser(companyA);
    const department = String(
      (await insertRow(db, 'departments', { tenant_id: companyA, name: 'Kinh doanh 3' }))['id'],
    );
    const team = await insertTeam({ department_id: department, leader_id: leader });
    await addMember(team, member);
    await addMember(team, leader);

    await assert.rejects(
      db.query('DELETE FROM departments WHERE id = $1', [department]),
      /fk_teams_department_id/,
    );
    await assert.rejects(
      db.query('DELETE FROM users WHERE id = $1', [leader]),
      /fk_teams_leader_id/,
    );
    await db.query('DELETE FROM users WHERE id = $1', [member]);
    const afterUserDelete: unknown[] = await db.query(
      'SELECT 1 FROM team_members WHERE team_id = $1',
      [team],
    );
    assert.equal(afterUserDelete.length, 1);
    await db.query('DELETE FROM teams WHERE id = $1', [team]);
    const afterTeamDelete: unknown[] = await db.query(
      'SELECT 1 FROM team_members WHERE team_id = $1',
      [team],
    );
    assert.equal(afterTeamDelete.length, 0);
  });

  it('updated_at tự cập nhật khi sửa team', async () => {
    const team = await insertTeam({
      created_at: '2020-01-01T00:00:00Z',
      updated_at: '2020-01-01T00:00:00Z',
    });
    await db.query(`UPDATE teams SET name = 'Nhóm đổi tên' WHERE id = $1`, [team]);
    const rows: { updated_at: Date }[] = await db.query(
      'SELECT updated_at FROM teams WHERE id = $1',
      [team],
    );
    assert.ok((rows[0]?.updated_at.getFullYear() ?? 0) > 2020);
  });

  it('revert rồi chạy lại toàn bộ migration sạch', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('teams', 'team_members')`,
    );
    assert.equal(tables.length, 0);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
