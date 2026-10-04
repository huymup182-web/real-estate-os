import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, describeTable, insertRow, revertAll } from './helpers.ts';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$test$test';
const FAMILY = '7b0e7f1e-7a7c-4a52-9c0e-2f6d1f0e5a11';

describe('TASK-040: bảng refresh_tokens', () => {
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

  function insertToken(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    seq += 1;
    return insertRow(db, 'refresh_tokens', {
      user_id: userA,
      tenant_id: companyA,
      token_hash: `hash-${seq}`,
      family_id: FAMILY,
      expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      ...values,
    });
  }

  it('có đủ cột đúng kiểu', async () => {
    assert.deepEqual(await describeTable(db, 'refresh_tokens'), [
      ['id', 'uuid', 'NO'],
      ['user_id', 'uuid', 'NO'],
      ['tenant_id', 'uuid', 'YES'],
      ['token_hash', 'character varying', 'NO'],
      ['family_id', 'uuid', 'NO'],
      ['device_info', 'text', 'YES'],
      ['ip_address', 'inet', 'YES'],
      ['expires_at', 'timestamp with time zone', 'NO'],
      ['revoked_at', 'timestamp with time zone', 'YES'],
      ['replaced_by', 'uuid', 'YES'],
      ['created_at', 'timestamp with time zone', 'NO'],
    ]);
  });

  it('tạo token cho user công ty và user nền tảng, lưu thiết bị và IP', async () => {
    const token = await insertToken({ device_info: 'Mozilla/5.0', ip_address: '10.0.0.1' });
    assert.equal(token['revoked_at'], null);
    assert.equal(token['replaced_by'], null);
    await insertToken({ user_id: platformUser, tenant_id: null });
  });

  it('token_hash là duy nhất và không được rỗng', async () => {
    await insertToken({ token_hash: 'trung-lap' });
    await assert.rejects(insertToken({ token_hash: 'trung-lap' }), /uq_refresh_tokens_token_hash/);
    await assert.rejects(
      insertToken({ token_hash: ' ' }),
      /ck_refresh_tokens_token_hash_not_blank/,
    );
  });

  it('expires_at phải sau created_at', async () => {
    await assert.rejects(
      insertToken({ expires_at: new Date(Date.now() - 1000) }),
      /ck_refresh_tokens_expires_after_created/,
    );
  });

  it('tenant_id phải trùng công ty của user, kể cả khi đổi sau này', async () => {
    await assert.rejects(insertToken({ user_id: userB }), /refresh_tokens_tenant_mismatch/);
    await assert.rejects(insertToken({ tenant_id: null }), /refresh_tokens_tenant_mismatch/);
    await assert.rejects(
      insertToken({ user_id: platformUser, tenant_id: companyA }),
      /refresh_tokens_tenant_mismatch/,
    );
    const token = await insertToken({});
    await assert.rejects(
      db.query('UPDATE refresh_tokens SET user_id = $1 WHERE id = $2', [userB, token['id']]),
      /refresh_tokens_tenant_mismatch/,
    );
  });

  it('xoay vòng: token cũ trỏ replaced_by tới token mới; xoá token mới thì replaced_by về NULL', async () => {
    const oldToken = await insertToken({});
    const newToken = await insertToken({});
    await db.query('UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $1 WHERE id = $2', [
      newToken['id'],
      oldToken['id'],
    ]);
    await db.query('DELETE FROM refresh_tokens WHERE id = $1', [newToken['id']]);
    const rows: { replaced_by: string | null }[] = await db.query(
      'SELECT replaced_by FROM refresh_tokens WHERE id = $1',
      [oldToken['id']],
    );
    assert.equal(rows[0]?.replaced_by, null);
  });

  it('xoá cứng user thì xoá các phiên của user', async () => {
    const user = await insertUser(companyA);
    await insertToken({ user_id: user });
    await db.query('DELETE FROM users WHERE id = $1', [user]);
    const rows: unknown[] = await db.query('SELECT 1 FROM refresh_tokens WHERE user_id = $1', [
      user,
    ]);
    assert.equal(rows.length, 0);
  });

  it('revert rồi chạy lại toàn bộ migration sạch', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'refresh_tokens'`,
    );
    assert.equal(tables.length, 0);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
