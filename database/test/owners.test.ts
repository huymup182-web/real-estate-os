import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, describeTable, insertRow, revertAll } from './helpers.ts';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$test$test';

describe('TASK-017: bảng owners và properties.owner_id', () => {
  let db: DataSource;
  let companyA: string;
  let companyB: string;
  let userA: string;
  let userB: string;
  let province: string;
  let ward: string;
  let seq = 0;

  before(async () => {
    db = await createCleanTestDataSource();
    await db.runMigrations();
    companyA = String((await insertRow(db, 'companies', { name: 'A', slug: 'cong-ty-a' }))['id']);
    companyB = String((await insertRow(db, 'companies', { name: 'B', slug: 'cong-ty-b' }))['id']);
    userA = await insertUser(companyA);
    userB = await insertUser(companyB);
    province = String((await insertRow(db, 'provinces', { code: '56', name: 'Khánh Hòa' }))['id']);
    ward = String(
      (
        await insertRow(db, 'wards', {
          province_id: province,
          code: '22333',
          name: 'Bắc Nha Trang',
        })
      )['id'],
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
      full_name: 'Môi giới',
    });
    return String(user['id']);
  }

  function insertOwner(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    return insertRow(db, 'owners', {
      tenant_id: companyA,
      full_name: 'Trần Thị B',
      phone: '+84901234567',
      ...values,
    });
  }

  function insertProperty(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    seq += 1;
    return insertRow(db, 'properties', {
      tenant_id: companyA,
      code: `BDS-${seq}`,
      title: 'Nhà phố',
      property_type: 'HOUSE',
      price: 1,
      area: 50,
      province_id: province,
      ward_id: ward,
      agent_id: userA,
      ...values,
    });
  }

  it('owners có đủ cột đúng kiểu', async () => {
    assert.deepEqual(await describeTable(db, 'owners'), [
      ['id', 'uuid', 'NO'],
      ['tenant_id', 'uuid', 'NO'],
      ['full_name', 'character varying', 'NO'],
      ['phone', 'character varying', 'NO'],
      ['email', 'USER-DEFINED', 'YES'],
      ['notes', 'text', 'YES'],
      ['created_by', 'uuid', 'YES'],
      ['updated_by', 'uuid', 'YES'],
      ['created_at', 'timestamp with time zone', 'NO'],
      ['updated_at', 'timestamp with time zone', 'NO'],
      ['deleted_at', 'timestamp with time zone', 'YES'],
    ]);
  });

  it('properties có thêm cột owner_id (NULL được)', async () => {
    const columns = await describeTable(db, 'properties');
    assert.deepEqual(
      columns.find(([name]) => name === 'owner_id'),
      ['owner_id', 'uuid', 'YES'],
    );
    const property = await insertProperty({});
    assert.equal(property['owner_id'], null);
  });

  it('SĐT bắt buộc và đúng dạng chuẩn, email đúng dạng, tên không rỗng', async () => {
    await insertOwner({
      email: 'Chu.Nha@Example.com',
      notes: 'Chỉ gọi buổi tối',
      created_by: userA,
    });
    await assert.rejects(insertOwner({ phone: null }), /phone/);
    await assert.rejects(insertOwner({ phone: '0901234567' }), /ck_owners_phone_format/);
    await assert.rejects(insertOwner({ email: 'khong-hop-le' }), /ck_owners_email_format/);
    await assert.rejects(insertOwner({ full_name: ' ' }), /ck_owners_full_name_not_blank/);
  });

  it('người tạo/sửa phải cùng công ty với chủ nhà', async () => {
    await assert.rejects(insertOwner({ created_by: userB }), /fk_owners_created_by/);
    await assert.rejects(insertOwner({ updated_by: userB }), /fk_owners_updated_by/);
  });

  it('BĐS chỉ gắn được chủ nhà cùng công ty', async () => {
    const ownerA = await insertOwner({});
    const ownerB = await insertOwner({ tenant_id: companyB });
    const property = await insertProperty({ owner_id: ownerA['id'] });
    assert.equal(property['owner_id'], ownerA['id']);
    await assert.rejects(insertProperty({ owner_id: ownerB['id'] }), /fk_properties_owner_id/);
    await assert.rejects(
      db.query('UPDATE properties SET owner_id = $1 WHERE id = $2', [ownerB['id'], property['id']]),
      /fk_properties_owner_id/,
    );
  });

  it('không xoá cứng được chủ nhà đang gắn với BĐS', async () => {
    const owner = await insertOwner({});
    await insertProperty({ owner_id: owner['id'] });
    await assert.rejects(
      db.query('DELETE FROM owners WHERE id = $1', [owner['id']]),
      /fk_properties_owner_id/,
    );
  });

  it('updated_at tự cập nhật', async () => {
    const owner = await insertOwner({
      created_at: '2020-01-01T00:00:00Z',
      updated_at: '2020-01-01T00:00:00Z',
    });
    await db.query(`UPDATE owners SET notes = 'Đã đổi' WHERE id = $1`, [owner['id']]);
    const rows: { updated_at: Date }[] = await db.query(
      'SELECT updated_at FROM owners WHERE id = $1',
      [owner['id']],
    );
    assert.ok((rows[0]?.updated_at.getFullYear() ?? 0) > 2020);
  });

  it('revert rồi chạy lại toàn bộ migration sạch', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'owners'`,
    );
    assert.equal(tables.length, 0);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
