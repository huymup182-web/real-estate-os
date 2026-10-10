import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, describeTable, insertRow, revertAll } from './helpers.ts';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$test$test';

describe('TASK-020: bảng property_favorites và property_views', () => {
  let db: DataSource;
  let companyA: string;
  let companyB: string;
  let userA: string;
  let userB: string;
  let province: string;
  let ward: string;
  let propertyA: string;
  let propertyB: string;
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
    propertyA = await insertProperty(companyA, userA);
    propertyB = await insertProperty(companyB, userB);
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

  async function insertProperty(tenantId: string, agentId: string): Promise<string> {
    seq += 1;
    const property = await insertRow(db, 'properties', {
      tenant_id: tenantId,
      code: `BDS-${seq}`,
      title: 'Nhà phố',
      property_type: 'HOUSE',
      price: 1,
      area: 50,
      province_id: province,
      ward_id: ward,
      agent_id: agentId,
    });
    return String(property['id']);
  }

  it('hai bảng có đủ cột đúng kiểu', async () => {
    assert.deepEqual(await describeTable(db, 'property_favorites'), [
      ['tenant_id', 'uuid', 'NO'],
      ['user_id', 'uuid', 'NO'],
      ['property_id', 'uuid', 'NO'],
      ['created_at', 'timestamp with time zone', 'NO'],
    ]);
    assert.deepEqual(await describeTable(db, 'property_views'), [
      ['id', 'uuid', 'NO'],
      ['tenant_id', 'uuid', 'NO'],
      ['property_id', 'uuid', 'NO'],
      ['user_id', 'uuid', 'NO'],
      ['viewed_at', 'timestamp with time zone', 'NO'],
    ]);
  });

  it('mỗi user lưu một BĐS yêu thích tối đa một lần', async () => {
    await insertRow(db, 'property_favorites', {
      tenant_id: companyA,
      user_id: userA,
      property_id: propertyA,
    });
    await assert.rejects(
      insertRow(db, 'property_favorites', {
        tenant_id: companyA,
        user_id: userA,
        property_id: propertyA,
      }),
      /pk_property_favorites/,
    );
  });

  it('không lưu yêu thích BĐS của công ty khác', async () => {
    await assert.rejects(
      insertRow(db, 'property_favorites', {
        tenant_id: companyA,
        user_id: userA,
        property_id: propertyB,
      }),
      /fk_property_favorites_property_id/,
    );
    await assert.rejects(
      insertRow(db, 'property_favorites', {
        tenant_id: companyB,
        user_id: userA,
        property_id: propertyB,
      }),
      /fk_property_favorites_user_id/,
    );
  });

  it('ghi được nhiều lượt xem của cùng user, chỉ trong công ty mình', async () => {
    await insertRow(db, 'property_views', {
      tenant_id: companyA,
      property_id: propertyA,
      user_id: userA,
    });
    await insertRow(db, 'property_views', {
      tenant_id: companyA,
      property_id: propertyA,
      user_id: userA,
    });
    const rows: { count: string }[] = await db.query(
      'SELECT count(*) FROM property_views WHERE property_id = $1',
      [propertyA],
    );
    assert.equal(rows[0]?.count, '2');
    await assert.rejects(
      insertRow(db, 'property_views', {
        tenant_id: companyA,
        property_id: propertyB,
        user_id: userA,
      }),
      /fk_property_views_property_id/,
    );
    await assert.rejects(
      insertRow(db, 'property_views', {
        tenant_id: companyB,
        property_id: propertyB,
        user_id: userA,
      }),
      /fk_property_views_user_id/,
    );
  });

  it('lượt xem chỉ thêm, không sửa', async () => {
    const view = await insertRow(db, 'property_views', {
      tenant_id: companyA,
      property_id: propertyA,
      user_id: userA,
    });
    await assert.rejects(
      db.query(`UPDATE property_views SET viewed_at = now() - interval '1 day' WHERE id = $1`, [
        view['id'],
      ]),
      /property_views_append_only/,
    );
  });

  it('xoá cứng user hoặc BĐS thì xoá yêu thích và lượt xem liên quan', async () => {
    const user = await insertUser(companyA);
    const property = await insertProperty(companyA, userA);
    await insertRow(db, 'property_favorites', {
      tenant_id: companyA,
      user_id: user,
      property_id: property,
    });
    await insertRow(db, 'property_views', {
      tenant_id: companyA,
      property_id: property,
      user_id: user,
    });
    await db.query('DELETE FROM users WHERE id = $1', [user]);
    const afterUser: unknown[] = await db.query(
      `SELECT 1 FROM property_favorites WHERE user_id = $1
       UNION ALL SELECT 1 FROM property_views WHERE user_id = $1`,
      [user],
    );
    assert.equal(afterUser.length, 0);

    await insertRow(db, 'property_favorites', {
      tenant_id: companyA,
      user_id: userA,
      property_id: property,
    });
    await insertRow(db, 'property_views', {
      tenant_id: companyA,
      property_id: property,
      user_id: userA,
    });
    await db.query('DELETE FROM properties WHERE id = $1', [property]);
    const afterProperty: unknown[] = await db.query(
      `SELECT 1 FROM property_favorites WHERE property_id = $1
       UNION ALL SELECT 1 FROM property_views WHERE property_id = $1`,
      [property],
    );
    assert.equal(afterProperty.length, 0);
  });

  it('revert rồi chạy lại toàn bộ migration sạch', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('property_favorites', 'property_views')`,
    );
    assert.equal(tables.length, 0);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
