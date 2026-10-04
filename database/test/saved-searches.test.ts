import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, describeTable, insertRow, revertAll } from './helpers.ts';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$test$test';

describe('TASK-021: bảng saved_searches', () => {
  let db: DataSource;
  let companyA: string;
  let companyB: string;
  let userA: string;
  let seq = 0;

  before(async () => {
    db = await createCleanTestDataSource();
    await db.runMigrations();
    companyA = String((await insertRow(db, 'companies', { name: 'A', slug: 'cong-ty-a' }))['id']);
    companyB = String((await insertRow(db, 'companies', { name: 'B', slug: 'cong-ty-b' }))['id']);
    userA = await insertUser(companyA);
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
      full_name: 'Môi giới',
    });
    return String(user['id']);
  }

  function insertSearch(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    return insertRow(db, 'saved_searches', {
      tenant_id: companyA,
      user_id: userA,
      name: 'Nhà Vĩnh Hải dưới 6 tỷ',
      filters: { q: 'vinh hai', priceMax: 6_000_000_000, propertyType: ['HOUSE'] },
      ...values,
    });
  }

  it('có đủ cột đúng kiểu', async () => {
    assert.deepEqual(await describeTable(db, 'saved_searches'), [
      ['id', 'uuid', 'NO'],
      ['tenant_id', 'uuid', 'NO'],
      ['user_id', 'uuid', 'NO'],
      ['name', 'character varying', 'NO'],
      ['filters', 'jsonb', 'NO'],
      ['notify', 'boolean', 'NO'],
      ['last_notified_at', 'timestamp with time zone', 'YES'],
      ['created_at', 'timestamp with time zone', 'NO'],
      ['updated_at', 'timestamp with time zone', 'NO'],
      ['deleted_at', 'timestamp with time zone', 'YES'],
    ]);
  });

  it('lưu bộ lọc dạng object, mặc định bật thông báo', async () => {
    const search = await insertSearch({});
    assert.equal(search['notify'], true);
    assert.equal(search['last_notified_at'], null);
    assert.deepEqual(search['filters'], {
      q: 'vinh hai',
      priceMax: 6_000_000_000,
      propertyType: ['HOUSE'],
    });
  });

  it('chặn bộ lọc không phải object và tên rỗng', async () => {
    await assert.rejects(
      insertSearch({ filters: JSON.stringify(['HOUSE']) }),
      /ck_saved_searches_filters_object/,
    );
    await assert.rejects(insertSearch({ filters: null }), /filters/);
    await assert.rejects(insertSearch({ name: '  ' }), /ck_saved_searches_name_not_blank/);
  });

  it('user phải cùng công ty với tìm kiếm', async () => {
    await assert.rejects(insertSearch({ tenant_id: companyB }), /fk_saved_searches_user_id/);
  });

  it('xoá cứng user thì xoá tìm kiếm đã lưu', async () => {
    const user = await insertUser(companyA);
    const search = await insertSearch({ user_id: user });
    await db.query('DELETE FROM users WHERE id = $1', [user]);
    const rows: unknown[] = await db.query('SELECT 1 FROM saved_searches WHERE id = $1', [
      search['id'],
    ]);
    assert.equal(rows.length, 0);
  });

  it('updated_at tự cập nhật', async () => {
    const search = await insertSearch({
      created_at: '2020-01-01T00:00:00Z',
      updated_at: '2020-01-01T00:00:00Z',
    });
    await db.query('UPDATE saved_searches SET notify = false WHERE id = $1', [search['id']]);
    const rows: { updated_at: Date }[] = await db.query(
      'SELECT updated_at FROM saved_searches WHERE id = $1',
      [search['id']],
    );
    assert.ok((rows[0]?.updated_at.getFullYear() ?? 0) > 2020);
  });

  it('revert rồi chạy lại toàn bộ migration sạch', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'saved_searches'`,
    );
    assert.equal(tables.length, 0);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
