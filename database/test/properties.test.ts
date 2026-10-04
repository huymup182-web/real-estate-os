import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, insertRow, revertAll } from './helpers.ts';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$test$test';

describe('TASK-014: bảng properties', () => {
  let db: DataSource;
  let companyA: string;
  let companyB: string;
  let agentA: string;
  let agentB: string;
  let provinceA: string;
  let provinceB: string;
  let districtA: string;
  let wardA: string;
  let wardB: string;
  let seq = 0;

  before(async () => {
    db = await createCleanTestDataSource();
    await db.runMigrations();
    companyA = String((await insertRow(db, 'companies', { name: 'A', slug: 'cong-ty-a' }))['id']);
    companyB = String((await insertRow(db, 'companies', { name: 'B', slug: 'cong-ty-b' }))['id']);
    agentA = await insertUser(companyA);
    agentB = await insertUser(companyB);
    provinceA = String((await insertRow(db, 'provinces', { code: '56', name: 'Khánh Hòa' }))['id']);
    provinceB = String(
      (await insertRow(db, 'provinces', { code: '79', name: 'TP. Hồ Chí Minh' }))['id'],
    );
    districtA = String(
      (
        await insertRow(db, 'districts', { province_id: provinceA, code: '568', name: 'Nha Trang' })
      )['id'],
    );
    wardA = String(
      (
        await insertRow(db, 'wards', {
          province_id: provinceA,
          code: '22333',
          name: 'Bắc Nha Trang',
        })
      )['id'],
    );
    wardB = String(
      (await insertRow(db, 'wards', { province_id: provinceB, code: '26734', name: 'Bến Thành' }))[
        'id'
      ],
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

  function insertProperty(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    seq += 1;
    return insertRow(db, 'properties', {
      tenant_id: companyA,
      code: `BDS-${String(seq).padStart(6, '0')}`,
      title: 'Nhà phố Vĩnh Hải',
      property_type: 'HOUSE',
      price: 5_000_000_000,
      area: 100,
      province_id: provinceA,
      ward_id: wardA,
      agent_id: agentA,
      ...values,
    });
  }

  it('tạo BĐS với giá trị mặc định và giá/m² tự tính', async () => {
    const property = await insertProperty({ area: 80 });
    assert.equal(property['transaction_type'], 'SALE');
    assert.equal(property['status'], 'AVAILABLE');
    assert.equal(property['verification_status'], 'UNVERIFIED');
    assert.equal(property['price_per_m2'], '62500000');
    assert.equal(property['location'], null);
    assert.equal(property['district_id'], null);
  });

  it('mã BĐS duy nhất trong công ty, trùng được ở công ty khác', async () => {
    await insertProperty({ code: 'BDS-999999' });
    await insertProperty({ tenant_id: companyB, agent_id: agentB, code: 'BDS-999999' });
    await assert.rejects(insertProperty({ code: 'BDS-999999' }), /uq_properties_tenant_id_code/);
  });

  it('chỉ nhận giá trị trong danh sách đã duyệt', async () => {
    for (const type of ['LAND', 'LAND_PLOT', 'AGRICULTURAL_LAND', 'APARTMENT']) {
      await insertProperty({ property_type: type });
    }
    await assert.rejects(
      insertProperty({ property_type: 'CASTLE' }),
      /ck_properties_property_type/,
    );
    await insertProperty({ legal_status: 'PRIVATE_BOOK', source: 'OWNER_DIRECT' });
    await assert.rejects(
      insertProperty({ legal_status: 'RED_BOOK' }),
      /ck_properties_legal_status/,
    );
    await assert.rejects(insertProperty({ source: 'FACEBOOK' }), /ck_properties_source/);
    await assert.rejects(insertProperty({ status: 'DELETED' }), /ck_properties_status/);
    await assert.rejects(
      insertProperty({ transaction_type: 'LEASE' }),
      /ck_properties_transaction_type/,
    );
    await assert.rejects(insertProperty({ direction: 'X' }), /ck_properties_direction/);
    await assert.rejects(insertProperty({ road_access: 'TRUCK' }), /ck_properties_road_access/);
    await assert.rejects(
      insertProperty({ verification_status: 'DONE' }),
      /ck_properties_verification_status/,
    );
  });

  it('chặn số liệu sai: giá âm, diện tích 0, số phòng âm, tiêu đề rỗng', async () => {
    await assert.rejects(insertProperty({ price: -1 }), /ck_properties_price/);
    await assert.rejects(insertProperty({ area: 0 }), /ck_properties_area/);
    await assert.rejects(insertProperty({ bedrooms: -1 }), /ck_properties_rooms/);
    await assert.rejects(insertProperty({ road_width: -2 }), /ck_properties_road_width/);
    await assert.rejects(insertProperty({ title: ' ' }), /ck_properties_title_not_blank/);
  });

  it('hoa hồng: loại và giá trị đi cùng nhau, phần trăm không quá 100', async () => {
    await insertProperty({ commission_type: 'PERCENT', commission_value: 1.5 });
    await insertProperty({ commission_type: 'FIXED', commission_value: 50_000_000 });
    await assert.rejects(
      insertProperty({ commission_type: 'PERCENT', commission_value: 150 }),
      /ck_properties_commission_value/,
    );
    await assert.rejects(
      insertProperty({ commission_type: 'FIXED', commission_value: -1 }),
      /ck_properties_commission_value/,
    );
    await assert.rejects(insertProperty({ commission_value: 10 }), /ck_properties_commission_pair/);
    await assert.rejects(
      insertProperty({ commission_type: 'FIXED' }),
      /ck_properties_commission_pair/,
    );
    await assert.rejects(
      insertProperty({ commission_type: 'BONUS', commission_value: 1 }),
      /ck_properties_commission_type/,
    );
  });

  it('toạ độ cùng có hoặc cùng trống, sinh cột location để tính khoảng cách', async () => {
    const property = await insertProperty({ latitude: 12.2388, longitude: 109.1967 });
    const rows: { lat: number; lng: number; meters: number }[] = await db.query(
      `SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
              ST_Distance(location, ST_SetSRID(ST_MakePoint(109.1967, 12.2478), 4326)::geography) AS meters
         FROM properties WHERE id = $1`,
      [property['id']],
    );
    const row = rows[0];
    assert.ok(row);
    assert.equal(Number(row.lat.toFixed(4)), 12.2388);
    assert.equal(Number(row.lng.toFixed(4)), 109.1967);
    assert.ok(row.meters > 900 && row.meters < 1100);
    await assert.rejects(insertProperty({ latitude: 12.2 }), /ck_properties_coordinates/);
    await assert.rejects(
      insertProperty({ latitude: 95, longitude: 109 }),
      /ck_properties_coordinates/,
    );
  });

  it('tìm được theo từ khoá không dấu', async () => {
    const property = await insertProperty({
      title: 'Bán nhà đường Phạm Văn Đồng',
      description: 'Gần biển, ô tô đỗ cửa',
      street_address: '12 Phạm Văn Đồng',
    });
    const rows: { id: string }[] = await db.query(
      `SELECT id FROM properties
        WHERE search_vector @@ plainto_tsquery('simple', immutable_unaccent($1))`,
      ['pham van dong o to'],
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      [property['id']],
    );
  });

  it('môi giới, người tạo, người xác minh phải cùng công ty với BĐS', async () => {
    await assert.rejects(insertProperty({ agent_id: agentB }), /fk_properties_agent_id/);
    await assert.rejects(insertProperty({ created_by: agentB }), /fk_properties_created_by/);
    await assert.rejects(insertProperty({ updated_by: agentB }), /fk_properties_updated_by/);
    await assert.rejects(insertProperty({ verified_by: agentB }), /fk_properties_verified_by/);
    await insertProperty({ created_by: agentA, updated_by: agentA, verified_by: agentA });
  });

  it('phường/xã và quận/huyện phải thuộc đúng tỉnh của BĐS', async () => {
    await insertProperty({ district_id: districtA });
    await assert.rejects(insertProperty({ ward_id: wardB }), /fk_properties_ward_id/);
    await assert.rejects(
      insertProperty({ province_id: provinceB, ward_id: wardB, district_id: districtA }),
      /fk_properties_district_id/,
    );
  });

  it('không xoá được môi giới hoặc phường/xã đang có BĐS', async () => {
    await assert.rejects(
      db.query('DELETE FROM users WHERE id = $1', [agentA]),
      /fk_properties_agent_id/,
    );
    await assert.rejects(
      db.query('DELETE FROM wards WHERE id = $1', [wardA]),
      /fk_properties_ward_id/,
    );
  });

  it('updated_at tự cập nhật', async () => {
    const property = await insertProperty({
      created_at: '2020-01-01T00:00:00Z',
      updated_at: '2020-01-01T00:00:00Z',
    });
    await db.query(`UPDATE properties SET price = 1 WHERE id = $1`, [property['id']]);
    const rows: { updated_at: Date; price_per_m2: string }[] = await db.query(
      'SELECT updated_at, price_per_m2 FROM properties WHERE id = $1',
      [property['id']],
    );
    assert.ok((rows[0]?.updated_at.getFullYear() ?? 0) > 2020);
    assert.equal(rows[0]?.price_per_m2, '0');
  });

  it('revert rồi chạy lại toàn bộ migration sạch', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'properties'`,
    );
    assert.equal(tables.length, 0);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
