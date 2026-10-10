import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, describeTable, insertRow, revertAll } from './helpers.ts';

const TIMESTAMPS: [string, string, string][] = [
  ['created_at', 'timestamp with time zone', 'NO'],
  ['updated_at', 'timestamp with time zone', 'NO'],
];

describe('TASK-013: bảng provinces, districts, wards', () => {
  let db: DataSource;
  let provinceA: string;
  let provinceB: string;
  let districtA: string;

  before(async () => {
    db = await createCleanTestDataSource();
    await db.runMigrations();
    provinceA = String((await insertRow(db, 'provinces', { code: '56', name: 'Khánh Hòa' }))['id']);
    provinceB = String(
      (await insertRow(db, 'provinces', { code: '79', name: 'TP. Hồ Chí Minh' }))['id'],
    );
    districtA = String(
      (
        await insertRow(db, 'districts', {
          province_id: provinceA,
          code: '568',
          name: 'Nha Trang',
          is_active: false,
        })
      )['id'],
    );
  });

  after(async () => {
    await db.destroy();
  });

  it('ba bảng có đủ cột đúng kiểu', async () => {
    assert.deepEqual(await describeTable(db, 'provinces'), [
      ['id', 'uuid', 'NO'],
      ['code', 'character varying', 'NO'],
      ['name', 'character varying', 'NO'],
      ['is_active', 'boolean', 'NO'],
      ...TIMESTAMPS,
    ]);
    assert.deepEqual(await describeTable(db, 'districts'), [
      ['id', 'uuid', 'NO'],
      ['province_id', 'uuid', 'NO'],
      ['code', 'character varying', 'NO'],
      ['name', 'character varying', 'NO'],
      ['is_active', 'boolean', 'NO'],
      ...TIMESTAMPS,
    ]);
    assert.deepEqual(await describeTable(db, 'wards'), [
      ['id', 'uuid', 'NO'],
      ['province_id', 'uuid', 'NO'],
      ['district_id', 'uuid', 'YES'],
      ['code', 'character varying', 'NO'],
      ['name', 'character varying', 'NO'],
      ['is_active', 'boolean', 'NO'],
      ...TIMESTAMPS,
    ]);
  });

  it('không có tenant_id và deleted_at (dữ liệu dùng chung)', async () => {
    const rows: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name IN ('provinces', 'districts', 'wards')
          AND column_name IN ('tenant_id', 'deleted_at')`,
    );
    assert.equal(rows.length, 0);
  });

  it('mã đơn vị duy nhất trong từng bảng, mã và tên không được rỗng', async () => {
    await assert.rejects(
      insertRow(db, 'provinces', { code: '56', name: 'Trùng' }),
      /uq_provinces_code/,
    );
    await assert.rejects(
      insertRow(db, 'districts', { province_id: provinceA, code: '568', name: 'Trùng' }),
      /uq_districts_code/,
    );
    await insertRow(db, 'wards', {
      province_id: provinceA,
      code: '22333',
      name: 'Phường Nha Trang',
    });
    await assert.rejects(
      insertRow(db, 'wards', { province_id: provinceA, code: '22333', name: 'Trùng' }),
      /uq_wards_code/,
    );
    await assert.rejects(
      insertRow(db, 'provinces', { code: ' ', name: 'X' }),
      /ck_provinces_code_not_blank/,
    );
    await assert.rejects(
      insertRow(db, 'provinces', { code: '01', name: '' }),
      /ck_provinces_name_not_blank/,
    );
    await assert.rejects(
      insertRow(db, 'wards', { province_id: provinceA, code: '1', name: ' ' }),
      /ck_wards_name_not_blank/,
    );
  });

  it('phường/xã mới không cần quận/huyện; phường cũ gắn quận cùng tỉnh', async () => {
    const ward = await insertRow(db, 'wards', {
      province_id: provinceA,
      code: '22334',
      name: 'Phường Bắc Nha Trang',
    });
    assert.equal(ward['district_id'], null);
    assert.equal(ward['is_active'], true);
    await insertRow(db, 'wards', {
      province_id: provinceA,
      district_id: districtA,
      code: '22335',
      name: 'Phường Vĩnh Hải',
      is_active: false,
    });
  });

  it('không gắn được quận/huyện của tỉnh khác hoặc tỉnh không tồn tại', async () => {
    await assert.rejects(
      insertRow(db, 'wards', {
        province_id: provinceB,
        district_id: districtA,
        code: '26734',
        name: 'Sai tỉnh',
      }),
      /fk_wards_district_id/,
    );
    await assert.rejects(
      insertRow(db, 'districts', {
        province_id: '00000000-0000-0000-0000-000000000000',
        code: '999',
        name: 'Không có tỉnh',
      }),
      /fk_districts_province_id/,
    );
  });

  it('không xoá được tỉnh hoặc quận/huyện đang được dùng', async () => {
    await assert.rejects(db.query('DELETE FROM provinces WHERE id = $1', [provinceA]), /fk_/);
    await assert.rejects(
      db.query('DELETE FROM districts WHERE id = $1', [districtA]),
      /fk_wards_district_id/,
    );
  });

  it('updated_at tự cập nhật', async () => {
    const province = await insertRow(db, 'provinces', {
      code: '01',
      name: 'Hà Nội',
      created_at: '2020-01-01T00:00:00Z',
      updated_at: '2020-01-01T00:00:00Z',
    });
    await db.query(`UPDATE provinces SET name = 'TP. Hà Nội' WHERE id = $1`, [province['id']]);
    const rows: { updated_at: Date }[] = await db.query(
      'SELECT updated_at FROM provinces WHERE id = $1',
      [province['id']],
    );
    assert.ok((rows[0]?.updated_at.getFullYear() ?? 0) > 2020);
  });

  it('revert rồi chạy lại toàn bộ migration sạch', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('provinces', 'districts', 'wards')`,
    );
    assert.equal(tables.length, 0);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
