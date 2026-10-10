import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, describeTable, insertRow, revertAll } from './helpers.ts';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$test$test';

describe('TASK-133: bảng ai_requests', () => {
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

  function insertRequest(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    return insertRow(db, 'ai_requests', {
      user_id: userA,
      tenant_id: companyA,
      feature: 'search',
      provider: 'anthropic',
      model: 'claude-test',
      status: 'SUCCESS',
      latency_ms: 120,
      ...values,
    });
  }

  it('có đủ cột đúng kiểu', async () => {
    assert.deepEqual(await describeTable(db, 'ai_requests'), [
      ['id', 'uuid', 'NO'],
      ['tenant_id', 'uuid', 'YES'],
      ['user_id', 'uuid', 'NO'],
      ['feature', 'character varying', 'NO'],
      ['provider', 'character varying', 'NO'],
      ['model', 'character varying', 'NO'],
      ['status', 'character varying', 'NO'],
      ['input_tokens', 'integer', 'YES'],
      ['output_tokens', 'integer', 'YES'],
      ['tool_names', 'ARRAY', 'NO'],
      ['error_code', 'character varying', 'YES'],
      ['latency_ms', 'integer', 'NO'],
      ['request_id', 'character varying', 'YES'],
      ['created_at', 'timestamp with time zone', 'NO'],
    ]);
  });

  it('ghi lượt thành công và lỗi; lỗi bắt buộc có error_code', async () => {
    const row = await insertRequest({ input_tokens: 10, output_tokens: 5 });
    assert.deepEqual(row['tool_names'], []);
    assert.ok(row['created_at'] instanceof Date);
    await insertRequest({ status: 'ERROR', error_code: 'TIMEOUT' });
    await insertRequest({ user_id: platformUser, tenant_id: null, tool_names: ['search'] });
    await assert.rejects(insertRequest({ status: 'ERROR' }), /ck_ai_requests_error_code/);
    await assert.rejects(insertRequest({ error_code: 'TIMEOUT' }), /ck_ai_requests_error_code/);
    await assert.rejects(insertRequest({ status: 'PENDING' }), /ck_ai_requests_status/);
  });

  it('kiểm tra feature, provider, model, token, latency', async () => {
    await assert.rejects(insertRequest({ feature: 'Search' }), /ck_ai_requests_feature/);
    await assert.rejects(insertRequest({ feature: 'ai.search' }), /ck_ai_requests_feature/);
    await assert.rejects(insertRequest({ provider: ' ' }), /ck_ai_requests_provider/);
    await assert.rejects(insertRequest({ model: '' }), /ck_ai_requests_model/);
    await assert.rejects(insertRequest({ input_tokens: -1 }), /ck_ai_requests_tokens/);
    await assert.rejects(insertRequest({ output_tokens: -1 }), /ck_ai_requests_tokens/);
    await assert.rejects(insertRequest({ latency_ms: -1 }), /ck_ai_requests_latency_ms/);
  });

  it('tenant_id phải trùng công ty của user, kể cả khi đổi sau này', async () => {
    await assert.rejects(insertRequest({ user_id: userB }), /ai_requests_tenant_mismatch/);
    await assert.rejects(insertRequest({ tenant_id: null }), /ai_requests_tenant_mismatch/);
    const row = await insertRequest({});
    await assert.rejects(
      db.query('UPDATE ai_requests SET user_id = $1 WHERE id = $2', [userB, row['id']]),
      /ai_requests_tenant_mismatch/,
    );
  });

  it('user đã có lượt gọi AI thì không xoá cứng được', async () => {
    const user = await insertUser(companyA);
    await insertRequest({ user_id: user });
    await assert.rejects(
      db.query('DELETE FROM users WHERE id = $1', [user]),
      /fk_ai_requests_user_id/,
    );
  });

  it('revert rồi chạy lại toàn bộ migration sạch', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'ai_requests'`,
    );
    assert.equal(tables.length, 0);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
