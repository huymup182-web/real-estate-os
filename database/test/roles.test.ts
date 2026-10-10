import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, describeTable, insertRow, revertAll } from './helpers.ts';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$test$test';

describe('TASK-009: bảng roles và user_roles', () => {
  let db: DataSource;
  let companyA: string;
  let companyB: string;
  let emailSeq = 0;

  before(async () => {
    db = await createCleanTestDataSource();
    await db.runMigrations();
    companyA = String((await insertRow(db, 'companies', { name: 'A', slug: 'cong-ty-a' }))['id']);
    companyB = String((await insertRow(db, 'companies', { name: 'B', slug: 'cong-ty-b' }))['id']);
  });

  after(async () => {
    await db.destroy();
  });

  function insertRole(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    return insertRow(db, 'roles', { tenant_id: companyA, name: 'Môi giới', ...values });
  }

  async function insertUser(tenantId: string | null): Promise<string> {
    emailSeq += 1;
    const user = await insertRow(db, 'users', {
      tenant_id: tenantId,
      email: `user${emailSeq}@example.com`,
      password_hash: HASH,
      full_name: 'Người dùng',
    });
    return String(user['id']);
  }

  function assignRole(userId: string, roleId: unknown, tenantId: string | null): Promise<unknown> {
    return insertRow(db, 'user_roles', { user_id: userId, role_id: roleId, tenant_id: tenantId });
  }

  it('roles có đủ cột đúng kiểu', async () => {
    assert.deepEqual(await describeTable(db, 'roles'), [
      ['id', 'uuid', 'NO'],
      ['tenant_id', 'uuid', 'YES'],
      ['code', 'character varying', 'NO'],
      ['name', 'character varying', 'NO'],
      ['description', 'text', 'YES'],
      ['is_system', 'boolean', 'NO'],
      ['created_at', 'timestamp with time zone', 'NO'],
      ['updated_at', 'timestamp with time zone', 'NO'],
      ['deleted_at', 'timestamp with time zone', 'YES'],
    ]);
  });

  it('user_roles có đủ cột đúng kiểu', async () => {
    assert.deepEqual(await describeTable(db, 'user_roles'), [
      ['user_id', 'uuid', 'NO'],
      ['role_id', 'uuid', 'NO'],
      ['tenant_id', 'uuid', 'YES'],
      ['created_at', 'timestamp with time zone', 'NO'],
    ]);
  });

  it('cùng code được dùng ở hai công ty khác nhau, không trùng trong một công ty', async () => {
    await insertRole({ code: 'AGENT', is_system: true });
    await insertRole({ tenant_id: companyB, code: 'AGENT', is_system: true });
    await assert.rejects(insertRole({ code: 'AGENT' }), /uq_roles_tenant_id_code/);
  });

  it('role nền tảng (tenant_id NULL) cũng không được trùng code', async () => {
    await insertRole({
      tenant_id: null,
      code: 'SUPER_ADMIN',
      name: 'Super admin',
      is_system: true,
    });
    await assert.rejects(
      insertRole({ tenant_id: null, code: 'SUPER_ADMIN', name: 'Trùng' }),
      /uq_roles_tenant_id_code/,
    );
  });

  it('dùng lại code sau khi role cũ bị soft delete', async () => {
    const old = await insertRole({ code: 'TEMP_ROLE' });
    await db.query('UPDATE roles SET deleted_at = now() WHERE id = $1', [old['id']]);
    const fresh = await insertRole({ code: 'TEMP_ROLE' });
    assert.notEqual(fresh['id'], old['id']);
  });

  it('is_system mặc định false; từ chối code sai định dạng và tên rỗng', async () => {
    const role = await insertRole({ code: 'CUSTOM_1' });
    assert.equal(role['is_system'], false);
    for (const code of ['agent', 'Team-Leader', '1ROLE', '']) {
      await assert.rejects(insertRole({ code }), /ck_roles_code_format/, code);
    }
    await assert.rejects(insertRole({ code: 'NO_NAME', name: ' ' }), /ck_roles_name_not_blank/);
  });

  it('gán nhiều role cho một user cùng công ty', async () => {
    const userId = await insertUser(companyA);
    const r1 = await insertRole({ code: 'MANAGER' });
    const r2 = await insertRole({ code: 'TEAM_LEADER' });
    await assignRole(userId, r1['id'], companyA);
    await assignRole(userId, r2['id'], companyA);
    const rows: unknown[] = await db.query('SELECT 1 FROM user_roles WHERE user_id = $1', [userId]);
    assert.equal(rows.length, 2);
    await assert.rejects(assignRole(userId, r1['id'], companyA), /pk_user_roles/);
  });

  it('chặn gán role của công ty B cho user công ty A', async () => {
    const userId = await insertUser(companyA);
    const roleB = await insertRole({ tenant_id: companyB, code: 'DIRECTOR' });
    await assert.rejects(assignRole(userId, roleB['id'], companyA), /user_roles_tenant_mismatch/);
    await assert.rejects(assignRole(userId, roleB['id'], companyB), /user_roles_tenant_mismatch/);
  });

  it('chặn gán role nền tảng cho user công ty và ngược lại', async () => {
    const platformRole = await insertRole({ tenant_id: null, code: 'PLATFORM_SUPPORT' });
    const companyUser = await insertUser(companyA);
    await assert.rejects(
      assignRole(companyUser, platformRole['id'], null),
      /user_roles_tenant_mismatch/,
    );
    const platformUser = await insertUser(null);
    const companyRole = await insertRole({ code: 'COLLABORATOR' });
    await assert.rejects(
      assignRole(platformUser, companyRole['id'], null),
      /user_roles_tenant_mismatch/,
    );
    await assignRole(platformUser, platformRole['id'], null);
  });

  it('chặn sửa user_roles thành tenant khác', async () => {
    const userId = await insertUser(companyA);
    const role = await insertRole({ code: 'AUDITOR' });
    await assignRole(userId, role['id'], companyA);
    await assert.rejects(
      db.query('UPDATE user_roles SET tenant_id = $1 WHERE user_id = $2', [companyB, userId]),
      /user_roles_tenant_mismatch/,
    );
  });

  it('xoá cứng user thì xoá luôn phân quyền; không xoá cứng được role đang được gán', async () => {
    const userId = await insertUser(companyA);
    const role = await insertRole({ code: 'ACCOUNTANT' });
    await assignRole(userId, role['id'], companyA);
    await assert.rejects(
      db.query('DELETE FROM roles WHERE id = $1', [role['id']]),
      /fk_user_roles_role_id/,
    );
    await db.query('DELETE FROM users WHERE id = $1', [userId]);
    const rows: unknown[] = await db.query('SELECT 1 FROM user_roles WHERE role_id = $1', [
      role['id'],
    ]);
    assert.equal(rows.length, 0);
  });

  it('revert xoá roles, user_roles và hàm kiểm tra, chạy lại được', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('roles', 'user_roles')`,
    );
    assert.equal(tables.length, 0);
    const functions: unknown[] = await db.query(
      `SELECT 1 FROM pg_proc WHERE proname = 'check_user_roles_tenant'`,
    );
    assert.equal(functions.length, 0);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
