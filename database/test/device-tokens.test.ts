import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, describeTable, insertRow, revertAll } from './helpers.ts';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$test$test';

describe('TASK-094: bảng device_tokens', () => {
  let db: DataSource;
  let companyA: string;
  let userA: string;
  let userB: string;
  let platformUser: string;
  let seq = 0;

  before(async () => {
    db = await createCleanTestDataSource();
    await db.runMigrations();
    companyA = String((await insertRow(db, 'companies', { name: 'A', slug: 'cong-ty-a' }))['id']);
    const companyB = String(
      (await insertRow(db, 'companies', { name: 'B', slug: 'cong-ty-b' }))['id'],
    );
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

  function insertToken(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    seq += 1;
    return insertRow(db, 'device_tokens', {
      user_id: userA,
      tenant_id: companyA,
      fcm_token: `fcm-${seq}`,
      platform: 'ANDROID',
      ...values,
    });
  }

  it('có đủ cột đúng kiểu', async () => {
    assert.deepEqual(await describeTable(db, 'device_tokens'), [
      ['id', 'uuid', 'NO'],
      ['user_id', 'uuid', 'NO'],
      ['tenant_id', 'uuid', 'YES'],
      ['fcm_token', 'text', 'NO'],
      ['platform', 'character varying', 'NO'],
      ['last_seen_at', 'timestamp with time zone', 'NO'],
      ['created_at', 'timestamp with time zone', 'NO'],
    ]);
  });

  it('tạo token cho user công ty và user nền tảng; platform chỉ ANDROID/IOS/WEB', async () => {
    const token = await insertToken({ platform: 'IOS' });
    assert.ok(token['last_seen_at'] instanceof Date);
    await insertToken({ user_id: platformUser, tenant_id: null, platform: 'WEB' });
    await assert.rejects(insertToken({ platform: 'WINDOWS' }), /ck_device_tokens_platform/);
  });

  it('fcm_token duy nhất, không rỗng, tối đa 4096 ký tự', async () => {
    await insertToken({ fcm_token: 'trung-lap' });
    await assert.rejects(insertToken({ fcm_token: 'trung-lap' }), /uq_device_tokens_fcm_token/);
    await assert.rejects(insertToken({ fcm_token: '  ' }), /ck_device_tokens_fcm_token/);
    await assert.rejects(
      insertToken({ fcm_token: 'x'.repeat(4097) }),
      /ck_device_tokens_fcm_token/,
    );
  });

  it('tenant_id phải trùng công ty của user, kể cả khi đổi sau này', async () => {
    await assert.rejects(insertToken({ user_id: userB }), /device_tokens_tenant_mismatch/);
    await assert.rejects(insertToken({ tenant_id: null }), /device_tokens_tenant_mismatch/);
    const token = await insertToken({});
    await assert.rejects(
      db.query('UPDATE device_tokens SET user_id = $1 WHERE id = $2', [userB, token['id']]),
      /device_tokens_tenant_mismatch/,
    );
  });

  it('xoá cứng user thì xoá token thiết bị của user', async () => {
    const user = await insertUser(companyA);
    await insertToken({ user_id: user });
    await db.query('DELETE FROM users WHERE id = $1', [user]);
    const rows: unknown[] = await db.query('SELECT 1 FROM device_tokens WHERE user_id = $1', [
      user,
    ]);
    assert.equal(rows.length, 0);
  });

  it('revert rồi chạy lại toàn bộ migration sạch', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'device_tokens'`,
    );
    assert.equal(tables.length, 0);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
