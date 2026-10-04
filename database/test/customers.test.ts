import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, describeTable, insertRow, revertAll } from './helpers.ts';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$test$test';

describe('TASK-018: bảng customers và customer_preferences', () => {
  let db: DataSource;
  let companyA: string;
  let companyB: string;
  let agentA: string;
  let agentB: string;
  let seq = 0;

  before(async () => {
    db = await createCleanTestDataSource();
    await db.runMigrations();
    companyA = String((await insertRow(db, 'companies', { name: 'A', slug: 'cong-ty-a' }))['id']);
    companyB = String((await insertRow(db, 'companies', { name: 'B', slug: 'cong-ty-b' }))['id']);
    agentA = await insertUser(companyA);
    agentB = await insertUser(companyB);
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

  function insertCustomer(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    return insertRow(db, 'customers', {
      tenant_id: companyA,
      full_name: 'Lê Văn C',
      phone: '+84912345678',
      ...values,
    });
  }

  async function insertPreference(
    values: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const customer = await insertCustomer({});
    return insertRow(db, 'customer_preferences', {
      tenant_id: companyA,
      customer_id: customer['id'],
      ...values,
    });
  }

  it('customers có đủ cột đúng kiểu', async () => {
    assert.deepEqual(await describeTable(db, 'customers'), [
      ['id', 'uuid', 'NO'],
      ['tenant_id', 'uuid', 'NO'],
      ['full_name', 'character varying', 'NO'],
      ['phone', 'character varying', 'NO'],
      ['email', 'USER-DEFINED', 'YES'],
      ['purpose', 'character varying', 'YES'],
      ['purchase_timeline', 'character varying', 'YES'],
      ['source', 'character varying', 'YES'],
      ['agent_id', 'uuid', 'YES'],
      ['status', 'character varying', 'NO'],
      ['lost_reason', 'text', 'YES'],
      ['notes', 'text', 'YES'],
      ['created_by', 'uuid', 'YES'],
      ['updated_by', 'uuid', 'YES'],
      ['created_at', 'timestamp with time zone', 'NO'],
      ['updated_at', 'timestamp with time zone', 'NO'],
      ['deleted_at', 'timestamp with time zone', 'YES'],
    ]);
  });

  it('customer_preferences có đủ cột đúng kiểu', async () => {
    assert.deepEqual(await describeTable(db, 'customer_preferences'), [
      ['id', 'uuid', 'NO'],
      ['tenant_id', 'uuid', 'NO'],
      ['customer_id', 'uuid', 'NO'],
      ['transaction_type', 'character varying', 'NO'],
      ['property_types', 'ARRAY', 'YES'],
      ['budget_min', 'bigint', 'YES'],
      ['budget_max', 'bigint', 'YES'],
      ['area_min', 'numeric', 'YES'],
      ['area_max', 'numeric', 'YES'],
      ['bedrooms_min', 'smallint', 'YES'],
      ['province_ids', 'ARRAY', 'YES'],
      ['district_ids', 'ARRAY', 'YES'],
      ['ward_ids', 'ARRAY', 'YES'],
      ['directions', 'ARRAY', 'YES'],
      ['legal_statuses', 'ARRAY', 'YES'],
      ['min_road_access', 'character varying', 'YES'],
      ['is_active', 'boolean', 'NO'],
      ['created_at', 'timestamp with time zone', 'NO'],
      ['updated_at', 'timestamp with time zone', 'NO'],
      ['deleted_at', 'timestamp with time zone', 'YES'],
    ]);
  });

  it('tạo khách mặc định trạng thái NEW, nhận các giá trị đã duyệt', async () => {
    const customer = await insertCustomer({});
    assert.equal(customer['status'], 'NEW');
    assert.equal(customer['agent_id'], null);
    for (const source of [
      'REFERRAL',
      'WALK_IN',
      'FACEBOOK',
      'ZALO',
      'TIKTOK',
      'WEBSITE',
      'BROKER_PARTNER',
      'OLD_CUSTOMER',
      'OTHER',
    ]) {
      await insertCustomer({ source });
    }
    await insertCustomer({
      purpose: 'INVESTMENT',
      purchase_timeline: 'WITHIN_3_MONTHS',
      status: 'LOST',
      lost_reason: 'Đã mua chỗ khác',
      email: 'khach@example.com',
      agent_id: agentA,
    });
  });

  it('chặn giá trị ngoài danh sách và dữ liệu sai dạng', async () => {
    await assert.rejects(insertCustomer({ source: 'GOOGLE' }), /ck_customers_source/);
    await assert.rejects(insertCustomer({ status: 'CLOSED' }), /ck_customers_status/);
    await assert.rejects(insertCustomer({ purpose: 'HOLIDAY' }), /ck_customers_purpose/);
    await assert.rejects(
      insertCustomer({ purchase_timeline: 'SOON' }),
      /ck_customers_purchase_timeline/,
    );
    await assert.rejects(insertCustomer({ phone: '0912345678' }), /ck_customers_phone_format/);
    await assert.rejects(insertCustomer({ email: 'sai' }), /ck_customers_email_format/);
    await assert.rejects(insertCustomer({ full_name: '' }), /ck_customers_full_name_not_blank/);
  });

  it('người phụ trách, người tạo/sửa phải cùng công ty với khách', async () => {
    await assert.rejects(insertCustomer({ agent_id: agentB }), /fk_customers_agent_id/);
    await assert.rejects(insertCustomer({ created_by: agentB }), /fk_customers_created_by/);
    await assert.rejects(insertCustomer({ updated_by: agentB }), /fk_customers_updated_by/);
  });

  it('nhu cầu: mặc định SALE, nhận danh sách loại BĐS/hướng/pháp lý và khu vực', async () => {
    const preference = await insertPreference({
      property_types: ['HOUSE', 'LAND_PLOT'],
      budget_min: 3_000_000_000,
      budget_max: 6_000_000_000,
      area_min: 60,
      area_max: 120,
      bedrooms_min: 3,
      province_ids: ['00000000-0000-0000-0000-000000000001'],
      directions: ['E', 'SE'],
      legal_statuses: ['PRIVATE_BOOK'],
      min_road_access: 'CAR',
    });
    assert.equal(preference['transaction_type'], 'SALE');
    assert.equal(preference['is_active'], true);
    assert.deepEqual(preference['property_types'], ['HOUSE', 'LAND_PLOT']);
  });

  it('nhu cầu: chặn giá trị ngoài danh sách và khoảng ngược', async () => {
    await assert.rejects(
      insertPreference({ property_types: ['HOUSE', 'CASTLE'] }),
      /ck_customer_preferences_property_types/,
    );
    await assert.rejects(
      insertPreference({ directions: ['X'] }),
      /ck_customer_preferences_directions/,
    );
    await assert.rejects(
      insertPreference({ legal_statuses: ['RED_BOOK'] }),
      /ck_customer_preferences_legal_statuses/,
    );
    await assert.rejects(
      insertPreference({ budget_min: 6, budget_max: 3 }),
      /ck_customer_preferences_budget/,
    );
    await assert.rejects(insertPreference({ budget_min: -1 }), /ck_customer_preferences_budget/);
    await assert.rejects(
      insertPreference({ area_min: 100, area_max: 50 }),
      /ck_customer_preferences_area/,
    );
    await assert.rejects(
      insertPreference({ bedrooms_min: -1 }),
      /ck_customer_preferences_bedrooms_min/,
    );
    await assert.rejects(
      insertPreference({ min_road_access: 'TRUCK' }),
      /ck_customer_preferences_min_road_access/,
    );
    await assert.rejects(
      insertPreference({ transaction_type: 'LEASE' }),
      /ck_customer_preferences_transaction_type/,
    );
  });

  it('nhu cầu chỉ gắn được với khách cùng công ty; xoá khách thì xoá nhu cầu', async () => {
    const customerB = await insertCustomer({ tenant_id: companyB });
    await assert.rejects(
      insertRow(db, 'customer_preferences', { tenant_id: companyA, customer_id: customerB['id'] }),
      /fk_customer_preferences_customer_id/,
    );
    const preference = await insertPreference({});
    await db.query('DELETE FROM customers WHERE id = $1', [preference['customer_id']]);
    const rows: unknown[] = await db.query('SELECT 1 FROM customer_preferences WHERE id = $1', [
      preference['id'],
    ]);
    assert.equal(rows.length, 0);
  });

  it('không xoá cứng được môi giới đang phụ trách khách', async () => {
    const agent = await insertUser(companyA);
    await insertCustomer({ agent_id: agent });
    await assert.rejects(
      db.query('DELETE FROM users WHERE id = $1', [agent]),
      /fk_customers_agent_id/,
    );
  });

  it('updated_at tự cập nhật ở cả hai bảng', async () => {
    const old = { created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z' };
    const customer = await insertCustomer(old);
    const preference = await insertRow(db, 'customer_preferences', {
      tenant_id: companyA,
      customer_id: customer['id'],
      ...old,
    });
    await db.query(`UPDATE customers SET status = 'CONTACTED' WHERE id = $1`, [customer['id']]);
    await db.query(`UPDATE customer_preferences SET is_active = false WHERE id = $1`, [
      preference['id'],
    ]);
    const rows: { updated_at: Date }[] = await db.query(
      `SELECT updated_at FROM customers WHERE id = $1
       UNION ALL SELECT updated_at FROM customer_preferences WHERE id = $2`,
      [customer['id'], preference['id']],
    );
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.updated_at.getFullYear() > 2020));
  });

  it('revert rồi chạy lại toàn bộ migration sạch', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('customers', 'customer_preferences')`,
    );
    assert.equal(tables.length, 0);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
