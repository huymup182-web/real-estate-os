import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, describeTable, insertRow, revertAll } from './helpers.ts';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$test$test';

describe('TASK-042: bảng password_reset_tokens', () => {
  let db: DataSource;
  let userId: string;
  let seq = 0;

  before(async () => {
    db = await createCleanTestDataSource();
    await db.runMigrations();
    userId = await insertUser();
  });

  after(async () => {
    await db.destroy();
  });

  async function insertUser(): Promise<string> {
    seq += 1;
    const user = await insertRow(db, 'users', {
      tenant_id: null,
      email: `user${seq}@example.com`,
      password_hash: HASH,
      full_name: 'Người dùng',
    });
    return String(user['id']);
  }

  function insertCode(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    return insertRow(db, 'password_reset_tokens', {
      user_id: userId,
      code_hash: 'a'.repeat(64),
      expires_at: new Date(Date.now() + 15 * 60 * 1000),
      ...values,
    });
  }

  it('có đủ cột đúng kiểu', async () => {
    assert.deepEqual(await describeTable(db, 'password_reset_tokens'), [
      ['id', 'uuid', 'NO'],
      ['user_id', 'uuid', 'NO'],
      ['code_hash', 'character varying', 'NO'],
      ['attempts', 'smallint', 'NO'],
      ['expires_at', 'timestamp with time zone', 'NO'],
      ['used_at', 'timestamp with time zone', 'YES'],
      ['created_at', 'timestamp with time zone', 'NO'],
    ]);
  });

  it('tạo mã với attempts = 0; hai mã trùng hash vẫn lưu được', async () => {
    const code = await insertCode({});
    assert.equal(code['attempts'], 0);
    assert.equal(code['used_at'], null);
    await insertCode({ user_id: await insertUser() });
  });

  it('chặn hash rỗng, attempts âm và expires_at không sau created_at', async () => {
    await assert.rejects(
      insertCode({ code_hash: ' ' }),
      /ck_password_reset_tokens_code_hash_not_blank/,
    );
    await assert.rejects(insertCode({ attempts: -1 }), /ck_password_reset_tokens_attempts/);
    await assert.rejects(
      insertCode({ expires_at: new Date(Date.now() - 1000) }),
      /ck_password_reset_tokens_expires_after_created/,
    );
  });

  it('user_id phải tồn tại; xoá cứng user thì xoá mã', async () => {
    await assert.rejects(
      insertCode({ user_id: '00000000-0000-4000-8000-000000000000' }),
      /fk_password_reset_tokens_user_id/,
    );
    const user = await insertUser();
    await insertCode({ user_id: user });
    await db.query('DELETE FROM users WHERE id = $1', [user]);
    const rows: unknown[] = await db.query(
      'SELECT 1 FROM password_reset_tokens WHERE user_id = $1',
      [user],
    );
    assert.equal(rows.length, 0);
  });

  it('revert rồi chạy lại toàn bộ migration sạch', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'password_reset_tokens'`,
    );
    assert.equal(tables.length, 0);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
