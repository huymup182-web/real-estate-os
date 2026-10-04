import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, describeTable, insertRow, revertAll } from './helpers.ts';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$test$test';

describe('TASK-024: bảng notifications', () => {
  let db: DataSource;
  let companyA: string;
  let companyB: string;
  let userA: string;
  let userB: string;
  let platformUser: string;
  let seq = 0;

  before(async () => {
    db = await createCleanTestDataSource();
    await db.runMigrations();
    companyA = String((await insertRow(db, 'companies', { name: 'A', slug: 'cong-ty-a' }))['id']);
    companyB = String((await insertRow(db, 'companies', { name: 'B', slug: 'cong-ty-b' }))['id']);
    userA = await insertUser(companyA);
    userB = await insertUser(companyB);
    platformUser = await insertUser(null);
  });

  after(async () => {
    await db.destroy();
  });

  async function insertUser(tenantId: string | null): Promise<string> {
    seq += 1;
    const user = await insertRow(db, 'users', {
      tenant_id: tenantId,
      email: `user${seq}@example.com`,
      password_hash: HASH,
      full_name: 'Người dùng',
    });
    return String(user['id']);
  }

  function insertNotification(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    return insertRow(db, 'notifications', {
      tenant_id: companyA,
      user_id: userA,
      type: 'NEW_PROPERTY',
      title: 'BĐS mới',
      body: 'Có BĐS mới ở Vĩnh Hải',
      ...values,
    });
  }

  it('có đủ cột đúng kiểu', async () => {
    assert.deepEqual(await describeTable(db, 'notifications'), [
      ['id', 'uuid', 'NO'],
      ['tenant_id', 'uuid', 'YES'],
      ['user_id', 'uuid', 'NO'],
      ['type', 'character varying', 'NO'],
      ['title', 'character varying', 'NO'],
      ['body', 'text', 'NO'],
      ['data', 'jsonb', 'NO'],
      ['read_at', 'timestamp with time zone', 'YES'],
      ['push_sent_at', 'timestamp with time zone', 'YES'],
      ['created_at', 'timestamp with time zone', 'NO'],
    ]);
  });

  it('tạo thông báo với data mặc định {}, nhận đủ các loại theo thiết kế', async () => {
    const notification = await insertNotification({});
    assert.deepEqual(notification['data'], {});
    assert.equal(notification['read_at'], null);
    for (const type of [
      'PROPERTY_UPDATED',
      'MATCHED_PROPERTY',
      'CUSTOMER_ASSIGNED',
      'NEW_LEAD',
      'VIEWING_REMINDER',
      'VERIFY_REQUIRED',
      'SYSTEM_NOTIFICATION',
    ]) {
      await insertNotification({ type, data: { propertyId: 'x' } });
    }
  });

  it('thông báo hệ thống tenant_id NULL gửi được cho user nền tảng', async () => {
    await insertNotification({
      tenant_id: null,
      user_id: platformUser,
      type: 'SYSTEM_NOTIFICATION',
    });
  });

  it('chặn loại lạ, tiêu đề/nội dung rỗng và data không phải object', async () => {
    await assert.rejects(insertNotification({ type: 'PROMO' }), /ck_notifications_type/);
    await assert.rejects(insertNotification({ title: ' ' }), /ck_notifications_title_not_blank/);
    await assert.rejects(insertNotification({ body: '' }), /ck_notifications_body_not_blank/);
    await assert.rejects(
      insertNotification({ data: JSON.stringify(['x']) }),
      /ck_notifications_data_object/,
    );
  });

  it('tenant_id phải trùng công ty của người nhận, kể cả khi đổi sau này', async () => {
    await assert.rejects(insertNotification({ user_id: userB }), /notifications_tenant_mismatch/);
    await assert.rejects(
      insertNotification({ tenant_id: null, user_id: userA }),
      /notifications_tenant_mismatch/,
    );
    await assert.rejects(
      insertNotification({ tenant_id: companyA, user_id: platformUser }),
      /notifications_tenant_mismatch/,
    );
    const notification = await insertNotification({});
    await assert.rejects(
      db.query('UPDATE notifications SET user_id = $1 WHERE id = $2', [userB, notification['id']]),
      /notifications_tenant_mismatch/,
    );
  });

  it('đánh dấu đã đọc được; xoá cứng user thì xoá hộp thư của user', async () => {
    const user = await insertUser(companyA);
    const notification = await insertNotification({ user_id: user });
    await db.query('UPDATE notifications SET read_at = now() WHERE id = $1', [notification['id']]);
    await db.query('DELETE FROM users WHERE id = $1', [user]);
    const rows: unknown[] = await db.query('SELECT 1 FROM notifications WHERE user_id = $1', [
      user,
    ]);
    assert.equal(rows.length, 0);
  });

  it('revert rồi chạy lại toàn bộ migration sạch', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'notifications'`,
    );
    assert.equal(tables.length, 0);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
