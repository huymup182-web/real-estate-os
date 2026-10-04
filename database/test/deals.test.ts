import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, describeTable, insertRow, revertAll } from './helpers.ts';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$test$test';

describe('TASK-023: bảng deals và commissions', () => {
  let db: DataSource;
  let companyA: string;
  let companyB: string;
  let agentA: string;
  let agentB: string;
  let customerA: string;
  let customerB: string;
  let propertyA: string;
  let propertyB: string;
  let province: string;
  let ward: string;
  let seq = 0;
  let dealA: string;

  before(async () => {
    db = await createCleanTestDataSource();
    await db.runMigrations();
    companyA = String((await insertRow(db, 'companies', { name: 'A', slug: 'cong-ty-a' }))['id']);
    companyB = String((await insertRow(db, 'companies', { name: 'B', slug: 'cong-ty-b' }))['id']);
    agentA = await insertUser(companyA);
    agentB = await insertUser(companyB);
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
    customerA = await insertCustomer(companyA);
    customerB = await insertCustomer(companyB);
    propertyA = await insertProperty(companyA, agentA);
    propertyB = await insertProperty(companyB, agentB);
    dealA = String((await insertDeal({}))['id']);
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

  async function insertCustomer(tenantId: string): Promise<string> {
    const customer = await insertRow(db, 'customers', {
      tenant_id: tenantId,
      full_name: 'Khách',
      phone: '+84912345678',
    });
    return String(customer['id']);
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

  function insertDeal(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    return insertRow(db, 'deals', {
      tenant_id: companyA,
      customer_id: customerA,
      property_id: propertyA,
      agent_id: agentA,
      ...values,
    });
  }

  function insertCommission(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    return insertRow(db, 'commissions', {
      tenant_id: companyA,
      deal_id: dealA,
      user_id: agentA,
      role_in_deal: 'SELLING_AGENT',
      amount: 50_000_000,
      ...values,
    });
  }

  it('deals và commissions có đủ cột đúng kiểu', async () => {
    assert.deepEqual(await describeTable(db, 'deals'), [
      ['id', 'uuid', 'NO'],
      ['tenant_id', 'uuid', 'NO'],
      ['customer_id', 'uuid', 'NO'],
      ['property_id', 'uuid', 'NO'],
      ['agent_id', 'uuid', 'NO'],
      ['stage', 'character varying', 'NO'],
      ['deal_price', 'bigint', 'YES'],
      ['deposit_amount', 'bigint', 'YES'],
      ['deposit_at', 'timestamp with time zone', 'YES'],
      ['closed_at', 'timestamp with time zone', 'YES'],
      ['notes', 'text', 'YES'],
      ['created_by', 'uuid', 'YES'],
      ['updated_by', 'uuid', 'YES'],
      ['created_at', 'timestamp with time zone', 'NO'],
      ['updated_at', 'timestamp with time zone', 'NO'],
      ['deleted_at', 'timestamp with time zone', 'YES'],
    ]);
    assert.deepEqual(await describeTable(db, 'commissions'), [
      ['id', 'uuid', 'NO'],
      ['tenant_id', 'uuid', 'NO'],
      ['deal_id', 'uuid', 'NO'],
      ['user_id', 'uuid', 'NO'],
      ['role_in_deal', 'character varying', 'NO'],
      ['amount', 'bigint', 'NO'],
      ['percent', 'numeric', 'YES'],
      ['status', 'character varying', 'NO'],
      ['paid_at', 'timestamp with time zone', 'YES'],
      ['created_at', 'timestamp with time zone', 'NO'],
      ['updated_at', 'timestamp with time zone', 'NO'],
      ['deleted_at', 'timestamp with time zone', 'YES'],
    ]);
  });

  it('deal mặc định NEGOTIATING, nhận đủ các giai đoạn và số tiền tỷ đồng', async () => {
    const deal = await insertDeal({});
    assert.equal(deal['stage'], 'NEGOTIATING');
    for (const stage of ['DEPOSIT', 'CONTRACT', 'WON', 'LOST']) {
      await insertDeal({ stage });
    }
    const big = await insertDeal({
      stage: 'DEPOSIT',
      deal_price: 12_500_000_000,
      deposit_amount: 500_000_000,
      deposit_at: '2026-10-01T03:00:00Z',
      created_by: agentA,
    });
    assert.equal(String(big['deal_price']), '12500000000');
  });

  it('deal chặn giai đoạn lạ và số tiền âm', async () => {
    await assert.rejects(insertDeal({ stage: 'CLOSED' }), /ck_deals_stage/);
    await assert.rejects(insertDeal({ deal_price: -1 }), /ck_deals_deal_price/);
    await assert.rejects(insertDeal({ deposit_amount: -1 }), /ck_deals_deposit_amount/);
  });

  it('khách, BĐS, môi giới, người tạo của deal phải cùng công ty', async () => {
    await assert.rejects(insertDeal({ customer_id: customerB }), /fk_deals_customer_id/);
    await assert.rejects(insertDeal({ property_id: propertyB }), /fk_deals_property_id/);
    await assert.rejects(insertDeal({ agent_id: agentB }), /fk_deals_agent_id/);
    await assert.rejects(insertDeal({ created_by: agentB }), /fk_deals_created_by/);
    await assert.rejects(insertDeal({ updated_by: agentB }), /fk_deals_updated_by/);
  });

  it('một deal chia hoa hồng cho nhiều người, mặc định PENDING', async () => {
    const leader = await insertUser(companyA);
    const commission = await insertCommission({ percent: 70 });
    assert.equal(commission['status'], 'PENDING');
    await insertCommission({ user_id: leader, role_in_deal: 'LEADER', amount: 0, percent: 0 });
    for (const roleInDeal of ['LISTING_AGENT', 'COLLABORATOR']) {
      await insertCommission({ role_in_deal: roleInDeal });
    }
    for (const status of ['APPROVED', 'PAID', 'CANCELLED']) {
      await insertCommission({ status });
    }
    const rows: unknown[] = await db.query('SELECT 1 FROM commissions WHERE deal_id = $1', [dealA]);
    assert.ok(rows.length >= 2);
  });

  it('hoa hồng chặn vai trò/trạng thái lạ, số tiền âm, thiếu số tiền, tỷ lệ ngoài 0–100', async () => {
    await assert.rejects(
      insertCommission({ role_in_deal: 'OWNER' }),
      /ck_commissions_role_in_deal/,
    );
    await assert.rejects(insertCommission({ status: 'DONE' }), /ck_commissions_status/);
    await assert.rejects(insertCommission({ amount: -1 }), /ck_commissions_amount/);
    await assert.rejects(insertCommission({ amount: null }), /amount/);
    await assert.rejects(insertCommission({ percent: 100.01 }), /ck_commissions_percent/);
    await assert.rejects(insertCommission({ percent: -0.5 }), /ck_commissions_percent/);
  });

  it('hoa hồng không gắn được deal hoặc người nhận của công ty khác', async () => {
    const dealB = await insertDeal({
      tenant_id: companyB,
      customer_id: customerB,
      property_id: propertyB,
      agent_id: agentB,
    });
    await assert.rejects(insertCommission({ deal_id: dealB['id'] }), /fk_commissions_deal_id/);
    await assert.rejects(insertCommission({ user_id: agentB }), /fk_commissions_user_id/);
  });

  it('không xoá cứng được deal còn hoa hồng, hay khách/BĐS/môi giới còn deal', async () => {
    // Bộ dữ liệu riêng để lỗi đến đúng từ deals/commissions, không phải bảng khác.
    const agentOnly = await insertUser(companyA);
    const customerOnly = await insertCustomer(companyA);
    const propertyOnly = await insertProperty(companyA, agentA);
    const deal = await insertDeal({
      customer_id: customerOnly,
      property_id: propertyOnly,
      agent_id: agentOnly,
    });
    const receiver = await insertUser(companyA);
    await insertCommission({ deal_id: deal['id'], user_id: receiver });
    await assert.rejects(
      db.query('DELETE FROM deals WHERE id = $1', [deal['id']]),
      /fk_commissions_deal_id/,
    );
    await assert.rejects(
      db.query('DELETE FROM users WHERE id = $1', [receiver]),
      /fk_commissions_user_id/,
    );
    await assert.rejects(
      db.query('DELETE FROM customers WHERE id = $1', [customerOnly]),
      /fk_deals_customer_id/,
    );
    await assert.rejects(
      db.query('DELETE FROM properties WHERE id = $1', [propertyOnly]),
      /fk_deals_property_id/,
    );
    await assert.rejects(
      db.query('DELETE FROM users WHERE id = $1', [agentOnly]),
      /fk_deals_agent_id/,
    );
  });

  it('updated_at tự cập nhật trên deals và commissions', async () => {
    const old = { created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z' };
    const deal = await insertDeal(old);
    const commission = await insertCommission(old);
    await db.query(`UPDATE deals SET stage = 'WON' WHERE id = $1`, [deal['id']]);
    await db.query(`UPDATE commissions SET status = 'PAID' WHERE id = $1`, [commission['id']]);
    for (const [table, id] of [
      ['deals', deal['id']],
      ['commissions', commission['id']],
    ] as const) {
      const rows: { updated_at: Date }[] = await db.query(
        `SELECT updated_at FROM ${table} WHERE id = $1`,
        [id],
      );
      assert.ok((rows[0]?.updated_at.getFullYear() ?? 0) > 2020, table);
    }
  });

  it('revert rồi chạy lại toàn bộ migration sạch', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('deals', 'commissions')`,
    );
    assert.equal(tables.length, 0);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
