import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, describeTable, insertRow, revertAll } from './helpers.ts';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$test$test';

describe('TASK-025: bảng audit_logs', () => {
  let db: DataSource;
  let companyA: string;
  let companyB: string;
  let userA: string;
  let platformUser: string;
  let seq = 0;

  before(async () => {
    db = await createCleanTestDataSource();
    await db.runMigrations();
    companyA = String((await insertRow(db, 'companies', { name: 'A', slug: 'cong-ty-a' }))['id']);
    companyB = String((await insertRow(db, 'companies', { name: 'B', slug: 'cong-ty-b' }))['id']);
    userA = await insertUser(companyA);
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

  function insertLog(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    return insertRow(db, 'audit_logs', {
      tenant_id: companyA,
      user_id: userA,
      action: 'property.update',
      ...values,
    });
  }

  it('có đủ cột đúng kiểu', async () => {
    assert.deepEqual(await describeTable(db, 'audit_logs'), [
      ['id', 'uuid', 'NO'],
      ['tenant_id', 'uuid', 'YES'],
      ['user_id', 'uuid', 'YES'],
      ['action', 'character varying', 'NO'],
      ['entity_type', 'character varying', 'YES'],
      ['entity_id', 'uuid', 'YES'],
      ['changes', 'jsonb', 'YES'],
      ['ip_address', 'inet', 'YES'],
      ['user_agent', 'text', 'YES'],
      ['request_id', 'character varying', 'YES'],
      ['created_at', 'timestamp with time zone', 'NO'],
    ]);
  });

  it('ghi nhật ký đầy đủ thông tin thao tác', async () => {
    const log = await insertLog({
      entity_type: 'property',
      entity_id: '00000000-0000-4000-8000-000000000001',
      changes: { price: [5_000_000_000, 4_800_000_000] },
      ip_address: '203.113.0.10',
      user_agent: 'Mozilla/5.0',
      request_id: 'req-1',
    });
    assert.deepEqual(log['changes'], { price: [5_000_000_000, 4_800_000_000] });
    await insertLog({ action: 'auth.login', ip_address: '2001:db8::1' });
  });

  it('ghi được nhật ký cấp nền tảng và thao tác không có user (hệ thống)', async () => {
    await insertLog({ tenant_id: null, user_id: platformUser, action: 'platform.company.create' });
    await insertLog({ tenant_id: companyB, user_id: platformUser, action: 'company.update' });
    await insertLog({ user_id: null, action: 'property.verify_required' });
  });

  it('user công ty không ghi được nhật ký của công ty khác hoặc cấp nền tảng', async () => {
    await assert.rejects(insertLog({ tenant_id: companyB }), /audit_logs_tenant_mismatch/);
    await assert.rejects(insertLog({ tenant_id: null }), /audit_logs_tenant_mismatch/);
  });

  it('chặn action sai định dạng, entity_id thiếu entity_type, changes không phải object, IP sai', async () => {
    await assert.rejects(insertLog({ action: 'Update' }), /ck_audit_logs_action_format/);
    await assert.rejects(insertLog({ action: 'property' }), /ck_audit_logs_action_format/);
    await assert.rejects(
      insertLog({ entity_id: '00000000-0000-4000-8000-000000000001' }),
      /ck_audit_logs_entity_id_requires_type/,
    );
    await assert.rejects(insertLog({ entity_type: ' ' }), /ck_audit_logs_entity_type_not_blank/);
    await assert.rejects(
      insertLog({ changes: JSON.stringify(['x']) }),
      /ck_audit_logs_changes_object/,
    );
    await assert.rejects(insertLog({ ip_address: 'not-an-ip' }), /inet/);
  });

  it('không sửa, xoá hay truncate được nhật ký', async () => {
    const log = await insertLog({});
    await assert.rejects(
      db.query(`UPDATE audit_logs SET action = 'property.delete' WHERE id = $1`, [log['id']]),
      /audit_logs_append_only/,
    );
    await assert.rejects(
      db.query('DELETE FROM audit_logs WHERE id = $1', [log['id']]),
      /audit_logs_append_only/,
    );
    await assert.rejects(db.query('TRUNCATE audit_logs'), /audit_logs_append_only/);
  });

  it('user hoặc công ty đã có nhật ký thì không xoá cứng được', async () => {
    const company = String(
      (await insertRow(db, 'companies', { name: 'C', slug: 'cong-ty-c' }))['id'],
    );
    const user = await insertUser(company);
    await insertLog({ tenant_id: company, user_id: user });
    await assert.rejects(
      db.query('DELETE FROM users WHERE id = $1', [user]),
      /fk_audit_logs_user_id/,
    );
    const other = String(
      (await insertRow(db, 'companies', { name: 'D', slug: 'cong-ty-d' }))['id'],
    );
    await insertLog({ tenant_id: other, user_id: null });
    await assert.rejects(
      db.query('DELETE FROM companies WHERE id = $1', [other]),
      /fk_audit_logs_tenant_id/,
    );
  });

  it('revert rồi chạy lại toàn bộ migration sạch', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'audit_logs'`,
    );
    assert.equal(tables.length, 0);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
