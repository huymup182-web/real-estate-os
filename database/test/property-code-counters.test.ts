import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, describeTable, insertRow, revertAll } from './helpers.ts';

/** Câu tăng bộ đếm giống backend dùng (PropertiesService). */
const NEXT_VALUE = `
  INSERT INTO property_code_counters (tenant_id, last_value) VALUES ($1, 1)
  ON CONFLICT (tenant_id) DO UPDATE SET last_value = property_code_counters.last_value + 1
  RETURNING last_value`;

describe('TASK-049: bảng property_code_counters', () => {
  let db: DataSource;
  let companyA: string;
  let companyB: string;

  before(async () => {
    db = await createCleanTestDataSource();
    await db.runMigrations();
    companyA = String((await insertRow(db, 'companies', { name: 'A', slug: 'cong-ty-a' }))['id']);
    companyB = String((await insertRow(db, 'companies', { name: 'B', slug: 'cong-ty-b' }))['id']);
  });

  after(async () => {
    await db.destroy();
  });

  async function next(tenantId: string): Promise<number> {
    const [row] = (await db.query(NEXT_VALUE, [tenantId])) as { last_value: string }[];
    return Number(row?.last_value);
  }

  it('có đủ cột đúng kiểu', async () => {
    assert.deepEqual(await describeTable(db, 'property_code_counters'), [
      ['tenant_id', 'uuid', 'NO'],
      ['last_value', 'bigint', 'NO'],
      ['updated_at', 'timestamp with time zone', 'NO'],
    ]);
  });

  it('đếm riêng theo từng công ty, bắt đầu từ 1', async () => {
    assert.equal(await next(companyA), 1);
    assert.equal(await next(companyA), 2);
    assert.equal(await next(companyB), 1);
    assert.equal(await next(companyA), 3);
  });

  it('nhiều lệnh tăng đồng thời không lấy trùng số', async () => {
    const values = await Promise.all(Array.from({ length: 20 }, () => next(companyB)));
    assert.equal(new Set(values).size, 20);
  });

  it('chặn last_value <= 0 và công ty không tồn tại', async () => {
    await assert.rejects(
      db.query('UPDATE property_code_counters SET last_value = 0 WHERE tenant_id = $1', [companyA]),
      /ck_property_code_counters_last_value/,
    );
    await assert.rejects(
      next('00000000-0000-4000-8000-000000000000'),
      /fk_property_code_counters_tenant_id/,
    );
  });

  it('revert rồi chạy lại toàn bộ migration sạch', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'property_code_counters'`,
    );
    assert.equal(tables.length, 0);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
