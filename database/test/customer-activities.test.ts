import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, describeTable, insertRow, revertAll } from './helpers.ts';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$test$test';

describe('TASK-019: bảng customer_activities', () => {
  let db: DataSource;
  let companyA: string;
  let companyB: string;
  let userA: string;
  let userB: string;
  let customerA: string;
  let customerB: string;
  let seq = 0;

  before(async () => {
    db = await createCleanTestDataSource();
    await db.runMigrations();
    companyA = String((await insertRow(db, 'companies', { name: 'A', slug: 'cong-ty-a' }))['id']);
    companyB = String((await insertRow(db, 'companies', { name: 'B', slug: 'cong-ty-b' }))['id']);
    userA = await insertUser(companyA);
    userB = await insertUser(companyB);
    customerA = await insertCustomer(companyA);
    customerB = await insertCustomer(companyB);
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

  function insertActivity(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    return insertRow(db, 'customer_activities', {
      tenant_id: companyA,
      customer_id: customerA,
      user_id: userA,
      type: 'CALL',
      ...values,
    });
  }

  it('có đủ cột đúng kiểu', async () => {
    assert.deepEqual(await describeTable(db, 'customer_activities'), [
      ['id', 'uuid', 'NO'],
      ['tenant_id', 'uuid', 'NO'],
      ['customer_id', 'uuid', 'NO'],
      ['user_id', 'uuid', 'NO'],
      ['type', 'character varying', 'NO'],
      ['content', 'text', 'YES'],
      ['property_ids', 'ARRAY', 'YES'],
      ['metadata', 'jsonb', 'NO'],
      ['occurred_at', 'timestamp with time zone', 'NO'],
      ['created_at', 'timestamp with time zone', 'NO'],
    ]);
  });

  it('ghi được đủ các loại hoạt động, metadata mặc định là object rỗng', async () => {
    for (const type of [
      'CALL',
      'MESSAGE',
      'PROPERTY_SENT',
      'VIEWING',
      'NEGOTIATION',
      'DEPOSIT',
      'NOTE',
      'STATUS_CHANGE',
      'ASSIGNMENT',
    ]) {
      await insertActivity({ type });
    }
    const activity = await insertActivity({
      type: 'STATUS_CHANGE',
      content: 'Khách đồng ý đi xem nhà',
      property_ids: ['00000000-0000-0000-0000-000000000001'],
      metadata: { from: 'CONTACTED', to: 'VIEWING' },
    });
    assert.deepEqual(activity['metadata'], { from: 'CONTACTED', to: 'VIEWING' });
    const plain = await insertActivity({});
    assert.deepEqual(plain['metadata'], {});
  });

  it('chặn loại hoạt động lạ và metadata không phải object', async () => {
    await assert.rejects(insertActivity({ type: 'EMAIL' }), /ck_customer_activities_type/);
    await assert.rejects(
      insertActivity({ metadata: JSON.stringify([1, 2]) }),
      /ck_customer_activities_metadata_object/,
    );
  });

  it('khách và người thực hiện phải cùng công ty', async () => {
    await assert.rejects(
      insertActivity({ customer_id: customerB }),
      /fk_customer_activities_customer_id/,
    );
    await assert.rejects(insertActivity({ user_id: userB }), /fk_customer_activities_user_id/);
    await insertRow(db, 'customer_activities', {
      tenant_id: companyB,
      customer_id: customerB,
      user_id: userB,
      type: 'NOTE',
    });
  });

  it('chỉ thêm, không sửa được lịch sử', async () => {
    const activity = await insertActivity({ content: 'Gọi lần 1' });
    await assert.rejects(
      db.query(`UPDATE customer_activities SET content = 'Đã sửa' WHERE id = $1`, [activity['id']]),
      /customer_activities_append_only/,
    );
  });

  it('không xoá cứng được khách hoặc user còn lịch sử', async () => {
    await assert.rejects(
      db.query('DELETE FROM customers WHERE id = $1', [customerA]),
      /fk_customer_activities_customer_id/,
    );
    await assert.rejects(
      db.query('DELETE FROM users WHERE id = $1', [userA]),
      /fk_customer_activities_user_id/,
    );
  });

  it('revert rồi chạy lại toàn bộ migration sạch', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'customer_activities'`,
    );
    assert.equal(tables.length, 0);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
