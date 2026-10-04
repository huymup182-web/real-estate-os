import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, describeTable, insertRow, revertAll } from './helpers.ts';

describe('TASK-010: bảng permissions và role_permissions', () => {
  let db: DataSource;
  let companyA: string;
  let companyRole: string;
  let platformRole: string;

  before(async () => {
    db = await createCleanTestDataSource();
    await db.runMigrations();
    companyA = String((await insertRow(db, 'companies', { name: 'A', slug: 'cong-ty-a' }))['id']);
    companyRole = String(
      (await insertRow(db, 'roles', { tenant_id: companyA, code: 'AGENT', name: 'Môi giới' }))[
        'id'
      ],
    );
    platformRole = String(
      (await insertRow(db, 'roles', { tenant_id: null, code: 'SUPER_ADMIN', name: 'Super admin' }))[
        'id'
      ],
    );
  });

  after(async () => {
    await db.destroy();
  });

  async function permissionId(code: string): Promise<string> {
    const rows: { id: string }[] = await db.query('SELECT id FROM permissions WHERE code = $1', [
      code,
    ]);
    const row = rows[0];
    if (!row) {
      throw new Error(`Không có permission ${code}`);
    }
    return row.id;
  }

  async function grant(roleId: string, code: string, scope: string): Promise<unknown> {
    return insertRow(db, 'role_permissions', {
      role_id: roleId,
      permission_id: await permissionId(code),
      scope,
    });
  }

  it('permissions và role_permissions có đủ cột đúng kiểu', async () => {
    assert.deepEqual(await describeTable(db, 'permissions'), [
      ['id', 'uuid', 'NO'],
      ['code', 'character varying', 'NO'],
      ['module', 'character varying', 'NO'],
      ['description', 'text', 'NO'],
      ['is_platform', 'boolean', 'NO'],
      ['created_at', 'timestamp with time zone', 'NO'],
    ]);
    assert.deepEqual(await describeTable(db, 'role_permissions'), [
      ['role_id', 'uuid', 'NO'],
      ['permission_id', 'uuid', 'NO'],
      ['scope', 'character varying', 'NO'],
    ]);
  });

  it('migration seed đủ danh mục quyền MVP, chỉ platform.company.manage là quyền nền tảng', async () => {
    const rows: { code: string; module: string; is_platform: boolean }[] = await db.query(
      'SELECT code, module, is_platform FROM permissions ORDER BY code',
    );
    assert.equal(rows.length, 27);
    assert.ok(
      rows.some((r) => r.code === 'property.view_owner_contact' && r.module === 'property'),
    );
    assert.ok(rows.some((r) => r.code === 'commission.manage' && r.module === 'commission'));
    assert.deepEqual(
      rows.filter((r) => r.is_platform).map((r) => [r.code, r.module]),
      [['platform.company.manage', 'platform']],
    );
  });

  it('code duy nhất, đúng định dạng và module khớp với code', async () => {
    const base = { description: 'Mô tả' };
    await assert.rejects(
      insertRow(db, 'permissions', { ...base, code: 'property.view', module: 'property' }),
      /uq_permissions_code/,
    );
    await assert.rejects(
      insertRow(db, 'permissions', { ...base, code: 'Property.View', module: 'property' }),
      /ck_permissions_code_format/,
    );
    await assert.rejects(
      insertRow(db, 'permissions', { ...base, code: 'property', module: 'property' }),
      /ck_permissions_code_format/,
    );
    await assert.rejects(
      insertRow(db, 'permissions', { ...base, code: 'report.export', module: 'property' }),
      /ck_permissions_module_matches_code/,
    );
    await assert.rejects(
      insertRow(db, 'permissions', { code: 'report.export', module: 'report', description: ' ' }),
      /ck_permissions_description_not_blank/,
    );
  });

  it('role công ty nhận quyền với scope hợp lệ, không gán trùng một quyền hai lần', async () => {
    await grant(companyRole, 'property.view', 'COMPANY');
    await grant(companyRole, 'property.edit', 'OWN');
    await assert.rejects(grant(companyRole, 'property.edit', 'TEAM'), /pk_role_permissions/);
    await assert.rejects(grant(companyRole, 'customer.view', 'ALL'), /ck_role_permissions_scope/);
  });

  it('role công ty không được có scope PLATFORM hay quyền nền tảng', async () => {
    await assert.rejects(
      grant(companyRole, 'customer.view', 'PLATFORM'),
      /role_permissions_scope_invalid/,
    );
    await assert.rejects(
      grant(companyRole, 'platform.company.manage', 'COMPANY'),
      /role_permissions_scope_invalid/,
    );
    await grant(companyRole, 'customer.view', 'OWN');
    await assert.rejects(
      db.query(
        `UPDATE role_permissions SET scope = 'PLATFORM'
          WHERE role_id = $1 AND permission_id = $2`,
        [companyRole, await permissionId('customer.view')],
      ),
      /role_permissions_scope_invalid/,
    );
  });

  it('role nền tảng chỉ dùng scope PLATFORM', async () => {
    await grant(platformRole, 'platform.company.manage', 'PLATFORM');
    await assert.rejects(
      grant(platformRole, 'user.view', 'COMPANY'),
      /role_permissions_scope_invalid/,
    );
  });

  it('xoá role thì xoá quyền của role; permission đang được gán thì không xoá được', async () => {
    const role = await insertRow(db, 'roles', { tenant_id: companyA, code: 'TEMP', name: 'Tạm' });
    const roleId = String(role['id']);
    await grant(roleId, 'report.view', 'TEAM');
    await assert.rejects(
      db.query('DELETE FROM permissions WHERE code = $1', ['report.view']),
      /fk_role_permissions_permission_id/,
    );
    await db.query('DELETE FROM roles WHERE id = $1', [roleId]);
    const rows: unknown[] = await db.query('SELECT 1 FROM role_permissions WHERE role_id = $1', [
      roleId,
    ]);
    assert.equal(rows.length, 0);
  });

  it('revert rồi chạy lại toàn bộ migration sạch', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('permissions', 'role_permissions')`,
    );
    assert.equal(tables.length, 0);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
