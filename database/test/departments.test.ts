import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, describeTable, insertRow, revertAll } from './helpers.ts';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$test$test';

describe('TASK-011: bảng departments và users.department_id', () => {
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

  async function insertUser(values: Record<string, unknown>): Promise<string> {
    emailSeq += 1;
    const user = await insertRow(db, 'users', {
      tenant_id: companyA,
      email: `user${emailSeq}@example.com`,
      password_hash: HASH,
      full_name: 'Người dùng',
      ...values,
    });
    return String(user['id']);
  }

  async function insertDepartment(values: Record<string, unknown>): Promise<string> {
    const department = await insertRow(db, 'departments', { tenant_id: companyA, ...values });
    return String(department['id']);
  }

  it('departments có đủ cột đúng kiểu', async () => {
    assert.deepEqual(await describeTable(db, 'departments'), [
      ['id', 'uuid', 'NO'],
      ['tenant_id', 'uuid', 'NO'],
      ['name', 'character varying', 'NO'],
      ['manager_id', 'uuid', 'YES'],
      ['created_at', 'timestamp with time zone', 'NO'],
      ['updated_at', 'timestamp with time zone', 'NO'],
      ['deleted_at', 'timestamp with time zone', 'YES'],
    ]);
  });

  it('tên phòng ban không trùng trong một công ty, dùng lại được sau soft delete và ở công ty khác', async () => {
    const sales = await insertDepartment({ name: 'Kinh doanh 1' });
    await insertDepartment({ tenant_id: companyB, name: 'Kinh doanh 1' });
    await assert.rejects(
      insertDepartment({ name: 'Kinh doanh 1' }),
      /uq_departments_tenant_id_name/,
    );
    await db.query('UPDATE departments SET deleted_at = now() WHERE id = $1', [sales]);
    await insertDepartment({ name: 'Kinh doanh 1' });
  });

  it('tên phòng ban không được rỗng, tenant_id bắt buộc', async () => {
    await assert.rejects(insertDepartment({ name: '  ' }), /ck_departments_name_not_blank/);
    await assert.rejects(insertDepartment({ tenant_id: null, name: 'X' }), /tenant_id/);
  });

  it('trưởng phòng phải là user cùng công ty', async () => {
    const managerA = await insertUser({});
    const managerB = await insertUser({ tenant_id: companyB });
    await insertDepartment({ name: 'Kinh doanh 2', manager_id: managerA });
    await assert.rejects(
      insertDepartment({ name: 'Kinh doanh 3', manager_id: managerB }),
      /fk_departments_manager_id/,
    );
  });

  it('user chỉ thuộc phòng ban của công ty mình; user nền tảng không có phòng ban', async () => {
    const departmentA = await insertDepartment({ name: 'Kinh doanh 4' });
    const departmentB = await insertDepartment({ tenant_id: companyB, name: 'Kinh doanh 4' });
    await insertUser({ department_id: departmentA });
    await assert.rejects(insertUser({ department_id: departmentB }), /fk_users_department_id/);
    await assert.rejects(
      insertUser({ tenant_id: null, department_id: departmentA }),
      /ck_users_department_requires_tenant/,
    );
    const user = await insertUser({});
    await assert.rejects(
      db.query('UPDATE users SET department_id = $1 WHERE id = $2', [departmentB, user]),
      /fk_users_department_id/,
    );
  });

  it('không xoá cứng được phòng ban còn user hoặc user đang là trưởng phòng', async () => {
    const manager = await insertUser({});
    const department = await insertDepartment({ name: 'Kinh doanh 5', manager_id: manager });
    await insertUser({ department_id: department });
    await assert.rejects(
      db.query('DELETE FROM departments WHERE id = $1', [department]),
      /fk_users_department_id/,
    );
    await assert.rejects(
      db.query('DELETE FROM users WHERE id = $1', [manager]),
      /fk_departments_manager_id/,
    );
  });

  it('updated_at tự cập nhật khi sửa phòng ban', async () => {
    const department = await insertDepartment({
      name: 'Kinh doanh 6',
      created_at: '2020-01-01T00:00:00Z',
      updated_at: '2020-01-01T00:00:00Z',
    });
    await db.query(`UPDATE departments SET name = 'Kinh doanh 7' WHERE id = $1`, [department]);
    const rows: { updated_at: Date }[] = await db.query(
      'SELECT updated_at FROM departments WHERE id = $1',
      [department],
    );
    assert.ok((rows[0]?.updated_at.getFullYear() ?? 0) > 2020);
  });

  it('revert rồi chạy lại toàn bộ migration sạch', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'departments'`,
    );
    assert.equal(tables.length, 0);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
