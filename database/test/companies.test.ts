import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, describeTable, insertRow, revertAll } from './helpers.ts';

describe('TASK-007: bảng companies', () => {
  let db: DataSource;

  before(async () => {
    db = await createCleanTestDataSource();
    await db.runMigrations();
  });

  after(async () => {
    await db.destroy();
  });

  function insertCompany(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    return insertRow(db, 'companies', values);
  }

  it('có đủ cột đúng kiểu và ràng buộc NULL', async () => {
    const summary = await describeTable(db, 'companies');
    assert.deepEqual(summary, [
      ['id', 'uuid', 'NO'],
      ['name', 'character varying', 'NO'],
      ['slug', 'character varying', 'NO'],
      ['status', 'character varying', 'NO'],
      ['settings', 'jsonb', 'NO'],
      ['created_at', 'timestamp with time zone', 'NO'],
      ['updated_at', 'timestamp with time zone', 'NO'],
      ['deleted_at', 'timestamp with time zone', 'YES'],
    ]);
  });

  it('tự sinh id, status mặc định ACTIVE, settings mặc định {}', async () => {
    const row = await insertCompany({ name: 'Công ty A', slug: 'cong-ty-a' });
    assert.match(String(row['id']), /^[0-9a-f-]{36}$/);
    assert.equal(row['status'], 'ACTIVE');
    assert.deepEqual(row['settings'], {});
    assert.ok(row['created_at'] instanceof Date);
    assert.equal(row['deleted_at'], null);
  });

  it('từ chối status không hợp lệ', async () => {
    await assert.rejects(
      insertCompany({ name: 'X', slug: 'x-status', status: 'DELETED' }),
      /ck_companies_status/,
    );
  });

  it('từ chối tên rỗng', async () => {
    await assert.rejects(
      insertCompany({ name: '   ', slug: 'x-name' }),
      /ck_companies_name_not_blank/,
    );
  });

  it('từ chối slug sai định dạng', async () => {
    for (const slug of ['Cong-Ty', 'cong ty', '-cong-ty', 'cong--ty', 'công-ty']) {
      await assert.rejects(insertCompany({ name: 'X', slug }), /ck_companies_slug_format/, slug);
    }
  });

  it('slug duy nhất trong các công ty chưa xoá, dùng lại được sau khi soft delete', async () => {
    const first = await insertCompany({ name: 'Công ty B', slug: 'cong-ty-b' });
    await assert.rejects(insertCompany({ name: 'Trùng', slug: 'cong-ty-b' }), /uq_companies_slug/);

    await db.query('UPDATE companies SET deleted_at = now() WHERE id = $1', [first['id']]);
    const reused = await insertCompany({ name: 'Công ty B mới', slug: 'cong-ty-b' });
    assert.notEqual(reused['id'], first['id']);
  });

  it('tự cập nhật updated_at khi sửa', async () => {
    const old = new Date('2020-01-01T00:00:00Z');
    const row = await insertCompany({
      name: 'Công ty C',
      slug: 'cong-ty-c',
      created_at: old,
      updated_at: old,
    });
    await db.query(`UPDATE companies SET name = 'Công ty C2' WHERE id = $1`, [row['id']]);
    const rows: { created_at: Date; updated_at: Date }[] = await db.query(
      'SELECT created_at, updated_at FROM companies WHERE id = $1',
      [row['id']],
    );
    const result = rows[0];
    assert.ok(result);
    assert.equal(result.created_at.getTime(), old.getTime());
    assert.ok(Date.now() - result.updated_at.getTime() < 60_000);
  });

  it('revert xoá sạch, chạy lại migration được', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'companies'`,
    );
    assert.equal(tables.length, 0);
    const functions: unknown[] = await db.query(
      `SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at'`,
    );
    assert.equal(functions.length, 0);

    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
