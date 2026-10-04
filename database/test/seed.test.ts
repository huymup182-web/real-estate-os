import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { verify } from '@node-rs/argon2';
import type { DataSource } from 'typeorm';

import { DEFAULT_ROLE_MATRIX, demoEmail, seedDemo } from '../src/seed.ts';
import { createCleanTestDataSource } from './helpers.ts';

const PASSWORD = 'mat-khau-test-123';

describe('TASK-027: dữ liệu demo', () => {
  let db: DataSource;
  let companyId: string;

  before(async () => {
    db = await createCleanTestDataSource();
    await db.runMigrations();
    const result = await seedDemo(db, PASSWORD);
    assert.equal(result.created, true);
    companyId = result.companyId;
  });

  after(async () => {
    await db.destroy();
  });

  async function count(table: string): Promise<number> {
    const rows: { n: number }[] = await db.query(
      `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
      [companyId],
    );
    return rows[0]?.n ?? 0;
  }

  async function scopeOf(role: string, permission: string): Promise<string | undefined> {
    const rows: { scope: string }[] = await db.query(
      `SELECT rp.scope FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE r.tenant_id = $1 AND r.code = $2 AND p.code = $3`,
      [companyId, role, permission],
    );
    return rows[0]?.scope;
  }

  it('có đúng số lượng theo roadmap: 1 công ty, 5 user, 20 BĐS, 10 khách', async () => {
    const companies: unknown[] = await db.query('SELECT 1 FROM companies');
    assert.equal(companies.length, 1);
    assert.equal(await count('users'), 5);
    assert.equal(await count('properties'), 20);
    assert.equal(await count('customers'), 10);
    assert.equal(await count('customer_preferences'), 10);
    assert.equal(await count('roles'), 6);
  });

  it('admin, manager, 3 agent có đúng role', async () => {
    const rows: { email: string; code: string }[] = await db.query(
      `SELECT u.email, r.code FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
        WHERE u.tenant_id = $1 ORDER BY u.email`,
      [companyId],
    );
    assert.deepEqual(
      rows.map((r) => [r.email, r.code]),
      [
        [demoEmail('admin'), 'COMPANY_ADMIN'],
        [demoEmail('agent1'), 'AGENT'],
        [demoEmail('agent2'), 'AGENT'],
        [demoEmail('agent3'), 'AGENT'],
        [demoEmail('manager'), 'MANAGER'],
      ],
    );
  });

  it('ma trận quyền khớp phase0/04-RBAC.md', async () => {
    const catalog: { code: string }[] = await db.query(
      'SELECT code FROM permissions WHERE NOT is_platform ORDER BY code',
    );
    assert.deepEqual(
      Object.keys(DEFAULT_ROLE_MATRIX).sort(),
      catalog.map((p) => p.code),
    );
    assert.equal(await scopeOf('COMPANY_ADMIN', 'admin.manage'), 'COMPANY');
    assert.equal(await scopeOf('AGENT', 'property.view'), 'COMPANY');
    assert.equal(await scopeOf('AGENT', 'property.edit'), 'OWN');
    assert.equal(await scopeOf('AGENT', 'property.delete'), undefined);
    assert.equal(await scopeOf('AGENT', 'team.view'), 'TEAM');
    assert.equal(await scopeOf('MANAGER', 'customer.view'), 'DEPARTMENT');
    assert.equal(await scopeOf('TEAM_LEADER', 'property.approve'), 'TEAM');
    assert.equal(await scopeOf('COLLABORATOR', 'property.verify'), undefined);
    assert.equal(await scopeOf('DIRECTOR', 'user.manage'), undefined);
  });

  it('mật khẩu lưu dạng argon2id và đúng mật khẩu đã truyền vào', async () => {
    const rows: { password_hash: string }[] = await db.query(
      'SELECT password_hash FROM users WHERE email = $1',
      [demoEmail('agent1')],
    );
    const passwordHash = rows[0]?.password_hash ?? '';
    assert.match(passwordHash, /^\$argon2id\$/);
    assert.equal(await verify(passwordHash, PASSWORD), true);
    assert.equal(await verify(passwordHash, 'sai-mat-khau'), false);
  });

  it('BĐS demo có toạ độ, tìm được theo chữ không dấu và gắn chủ nhà', async () => {
    const located: unknown[] = await db.query(
      'SELECT 1 FROM properties WHERE tenant_id = $1 AND location IS NOT NULL AND owner_id IS NOT NULL',
      [companyId],
    );
    assert.equal(located.length, 20);
    const found: unknown[] = await db.query(
      `SELECT 1 FROM properties
        WHERE search_vector @@ plainto_tsquery('simple'::regconfig, immutable_unaccent($1))`,
      ['bac nha trang'],
    );
    assert.ok(found.length > 0);
  });

  it('chạy lại không tạo trùng; mật khẩu ngắn bị từ chối', async () => {
    const again = await seedDemo(db, PASSWORD);
    assert.deepEqual(again, { created: false, companyId });
    assert.equal(await count('properties'), 20);
    await assert.rejects(seedDemo(db, 'ngan'), /ít nhất 8 ký tự/);
  });
});
