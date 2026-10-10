import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, describeTable, insertRow, revertAll } from './helpers.ts';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$test$test';

describe('TASK-061: bảng property_share_links', () => {
  let db: DataSource;
  let companyA: string;
  let companyB: string;
  let userA: string;
  let userB: string;
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
    const province = String(
      (await insertRow(db, 'provinces', { code: '56', name: 'Khánh Hòa' }))['id'],
    );
    const ward = String(
      (
        await insertRow(db, 'wards', {
          province_id: province,
          code: '22333',
          name: 'Bắc Nha Trang',
        })
      )['id'],
    );
    propertyA = await insertProperty(companyA, userA, province, ward);
    propertyB = await insertProperty(companyB, userB, province, ward);
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

  async function insertProperty(
    tenantId: string,
    agentId: string,
    provinceId: string,
    wardId: string,
  ): Promise<string> {
    seq += 1;
    const property = await insertRow(db, 'properties', {
      tenant_id: tenantId,
      code: `BDS-${seq}`,
      title: 'Nhà phố',
      property_type: 'HOUSE',
      price: 1,
      area: 50,
      province_id: provinceId,
      ward_id: wardId,
      agent_id: agentId,
    });
    return String(property['id']);
  }

  function hash(): string {
    seq += 1;
    return seq.toString(16).padStart(64, '0');
  }

  function insertLink(values: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return insertRow(db, 'property_share_links', {
      tenant_id: companyA,
      property_id: propertyA,
      token_hash: hash(),
      created_by: userA,
      expires_at: new Date(Date.now() + 86_400_000),
      ...values,
    });
  }

  it('có đủ cột đúng kiểu', async () => {
    assert.deepEqual(await describeTable(db, 'property_share_links'), [
      ['id', 'uuid', 'NO'],
      ['tenant_id', 'uuid', 'NO'],
      ['property_id', 'uuid', 'NO'],
      ['token_hash', 'character', 'NO'],
      ['created_by', 'uuid', 'YES'],
      ['expires_at', 'timestamp with time zone', 'NO'],
      ['revoked_at', 'timestamp with time zone', 'YES'],
      ['view_count', 'integer', 'NO'],
      ['created_at', 'timestamp with time zone', 'NO'],
    ]);
  });

  it('tạo link hợp lệ, view_count mặc định 0', async () => {
    const link = await insertLink();
    assert.equal(link['view_count'], 0);
    assert.equal(link['revoked_at'], null);
  });

  it('token_hash duy nhất, đúng dạng 64 ký tự hex', async () => {
    const tokenHash = hash();
    await insertLink({ token_hash: tokenHash });
    await assert.rejects(
      insertLink({ token_hash: tokenHash }),
      /uq_property_share_links_token_hash/,
    );
    await assert.rejects(
      insertLink({ token_hash: 'X'.repeat(64) }),
      /ck_property_share_links_token_hash/,
    );
  });

  it('hết hạn phải sau lúc tạo; view_count không âm', async () => {
    await assert.rejects(
      insertLink({ expires_at: new Date(Date.now() - 1000) }),
      /ck_property_share_links_expires_at/,
    );
    await assert.rejects(insertLink({ view_count: -1 }), /ck_property_share_links_view_count/);
  });

  it('BĐS và người tạo phải cùng công ty', async () => {
    await assert.rejects(
      insertLink({ property_id: propertyB }),
      /fk_property_share_links_property_id/,
    );
    await assert.rejects(insertLink({ created_by: userB }), /fk_property_share_links_created_by/);
  });

  it('xoá cứng BĐS thì xoá link theo', async () => {
    const province = String(
      (await db.query('SELECT province_id FROM properties WHERE id = $1', [propertyA]))[0]
        .province_id,
    );
    const ward = String(
      (await db.query('SELECT ward_id FROM properties WHERE id = $1', [propertyA]))[0].ward_id,
    );
    const property = await insertProperty(companyA, userA, province, ward);
    const link = await insertLink({ property_id: property });
    await db.query('DELETE FROM properties WHERE id = $1', [property]);
    const rows: unknown[] = await db.query('SELECT 1 FROM property_share_links WHERE id = $1', [
      link['id'],
    ]);
    assert.equal(rows.length, 0);
  });

  it('revert rồi chạy lại toàn bộ migration sạch', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'property_share_links'`,
    );
    assert.equal(tables.length, 0);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
