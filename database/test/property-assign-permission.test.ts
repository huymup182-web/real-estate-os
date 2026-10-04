import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, insertRow, revertAll } from './helpers.ts';

describe('TASK-056: quyền property.assign', () => {
  let db: DataSource;
  let company: string;

  before(async () => {
    db = await createCleanTestDataSource();
    await db.runMigrations();
    // Công ty đã có trước migration: hoàn tác tới migration TASK-056, tạo role, rồi chạy lại.
    await revertAssignMigration();
    company = String((await insertRow(db, 'companies', { name: 'A', slug: 'cong-ty-a' }))['id']);
    for (const code of ['COMPANY_ADMIN', 'DIRECTOR', 'MANAGER', 'TEAM_LEADER', 'AGENT']) {
      await insertRow(db, 'roles', { tenant_id: company, code, name: code, is_system: true });
    }
    await insertRow(db, 'roles', { tenant_id: company, code: 'CUSTOM', name: 'Tự tạo' });
    await db.runMigrations();
  });

  after(async () => {
    await db.destroy();
  });

  /** Hoàn tác các migration từ migration TASK-056 trở về sau (kể cả nó). */
  async function revertAssignMigration(): Promise<void> {
    for (;;) {
      const rows: unknown[] = await db.query(
        `SELECT 1 FROM migrations WHERE name = 'AddPropertyAssignPermission1791128000000'`,
      );
      if (rows.length === 0) {
        return;
      }
      await db.undoLastMigration();
    }
  }

  async function grants(): Promise<string[]> {
    const rows: { code: string; scope: string }[] = await db.query(
      `SELECT r.code, rp.scope FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE p.code = 'property.assign' ORDER BY r.code`,
    );
    return rows.map((row) => `${row.code}:${row.scope}`);
  }

  it('có quyền property.assign thuộc module property, không phải quyền nền tảng', async () => {
    const rows: { module: string; is_platform: boolean }[] = await db.query(
      `SELECT module, is_platform FROM permissions WHERE code = 'property.assign'`,
    );
    assert.deepEqual(rows, [{ module: 'property', is_platform: false }]);
  });

  it('gán cho role mặc định của công ty đã có như customer.assign; role tự tạo, AGENT không có', async () => {
    assert.deepEqual(await grants(), [
      'COMPANY_ADMIN:COMPANY',
      'DIRECTOR:COMPANY',
      'MANAGER:DEPARTMENT',
      'TEAM_LEADER:TEAM',
    ]);
  });

  it('hoàn tác xoá quyền và các dòng gán; chạy lại toàn bộ migration sạch', async () => {
    await revertAssignMigration();
    assert.equal(
      (await db.query(`SELECT 1 FROM permissions WHERE code = 'property.assign'`)).length,
      0,
    );
    await db.runMigrations();
    assert.equal((await grants()).length, 4);
    await revertAll(db);
    await db.runMigrations();
  });
});
