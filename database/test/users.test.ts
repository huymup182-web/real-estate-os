import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, describeTable, insertRow, revertAll } from './helpers.ts';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$test$test';

describe('TASK-008: bảng users', () => {
  let db: DataSource;
  let companyA: string;
  let companyB: string;

  before(async () => {
    db = await createCleanTestDataSource();
    await db.runMigrations();
    companyA = String((await insertRow(db, 'companies', { name: 'A', slug: 'cong-ty-a' }))['id']);
    companyB = String((await insertRow(db, 'companies', { name: 'B', slug: 'cong-ty-b' }))['id']);
  });

  after(async () => {
    await db.destroy();
  });

  function insertUser(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    return insertRow(db, 'users', {
      tenant_id: companyA,
      password_hash: HASH,
      full_name: 'Nguyễn Văn A',
      ...values,
    });
  }

  it('có đủ cột đúng kiểu và ràng buộc NULL', async () => {
    assert.deepEqual(await describeTable(db, 'users'), [
      ['id', 'uuid', 'NO'],
      ['tenant_id', 'uuid', 'YES'],
      ['email', 'USER-DEFINED', 'YES'],
      ['phone', 'character varying', 'YES'],
      ['password_hash', 'character varying', 'NO'],
      ['full_name', 'character varying', 'NO'],
      ['avatar_url', 'text', 'YES'],
      ['status', 'character varying', 'NO'],
      ['last_login_at', 'timestamp with time zone', 'YES'],
      ['created_at', 'timestamp with time zone', 'NO'],
      ['updated_at', 'timestamp with time zone', 'NO'],
      ['deleted_at', 'timestamp with time zone', 'YES'],
    ]);
  });

  it('tạo user của công ty với giá trị mặc định', async () => {
    const user = await insertUser({ email: 'agent1@example.com' });
    assert.equal(user['tenant_id'], companyA);
    assert.equal(user['status'], 'ACTIVE');
    assert.equal(user['last_login_at'], null);
  });

  it('cho phép user nền tảng (SUPER_ADMIN) không có tenant_id', async () => {
    const user = await insertUser({ tenant_id: null, email: 'root@example.com' });
    assert.equal(user['tenant_id'], null);
  });

  it('từ chối tenant_id không tồn tại', async () => {
    await assert.rejects(
      insertUser({ tenant_id: '00000000-0000-0000-0000-000000000000', email: 'x1@example.com' }),
      /fk_users_tenant_id/,
    );
  });

  it('không cho xoá cứng công ty còn user', async () => {
    const company = await insertRow(db, 'companies', { name: 'C', slug: 'cong-ty-c' });
    await insertUser({ tenant_id: company['id'], email: 'c1@example.com' });
    await assert.rejects(
      db.query('DELETE FROM companies WHERE id = $1', [company['id']]),
      /fk_users_tenant_id/,
    );
  });

  it('email duy nhất toàn hệ thống, không phân biệt hoa thường, kể cả khác công ty', async () => {
    await insertUser({ email: 'Sale@Example.com' });
    await assert.rejects(
      insertUser({ tenant_id: companyB, email: 'sale@example.COM' }),
      /uq_users_email/,
    );
  });

  it('số điện thoại duy nhất toàn hệ thống', async () => {
    await insertUser({ phone: '+84901234567' });
    await assert.rejects(
      insertUser({ tenant_id: companyB, phone: '+84901234567' }),
      /uq_users_phone/,
    );
  });

  it('dùng lại email/phone được sau khi user cũ bị soft delete', async () => {
    const old = await insertUser({ email: 'reuse@example.com', phone: '+84911111111' });
    await db.query('UPDATE users SET deleted_at = now() WHERE id = $1', [old['id']]);
    const fresh = await insertUser({ email: 'reuse@example.com', phone: '+84911111111' });
    assert.notEqual(fresh['id'], old['id']);
  });

  it('bắt buộc có email hoặc số điện thoại', async () => {
    await assert.rejects(insertUser({}), /ck_users_email_or_phone/);
    const phoneOnly = await insertUser({ phone: '+84922222222' });
    assert.equal(phoneOnly['email'], null);
  });

  it('từ chối email sai định dạng', async () => {
    for (const email of ['khong-co-a-cong', 'a@b', 'a b@example.com', '@example.com']) {
      await assert.rejects(insertUser({ email }), /ck_users_email_format/, email);
    }
  });

  it('từ chối số điện thoại không ở dạng chuẩn +84...', async () => {
    for (const phone of ['0901234567', '+84 901 234 567', '+84-901234567', '+123']) {
      await assert.rejects(insertUser({ phone }), /ck_users_phone_format/, phone);
    }
  });

  it('từ chối status sai, password_hash rỗng, họ tên rỗng', async () => {
    await assert.rejects(
      insertUser({ email: 's1@example.com', status: 'BANNED' }),
      /ck_users_status/,
    );
    await assert.rejects(
      insertUser({ email: 's2@example.com', password_hash: ' ' }),
      /ck_users_password_hash_not_blank/,
    );
    await assert.rejects(
      insertUser({ email: 's3@example.com', full_name: '' }),
      /ck_users_full_name_not_blank/,
    );
  });

  it('có UNIQUE (tenant_id, id) để bảng khác tham chiếu kèm tenant', async () => {
    const rows: { def: string }[] = await db.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'uq_users_tenant_id_id'`,
    );
    assert.equal(rows[0]?.def, 'UNIQUE (tenant_id, id)');
  });

  it('tự cập nhật updated_at khi sửa', async () => {
    const old = new Date('2020-01-01T00:00:00Z');
    const user = await insertUser({ email: 'upd@example.com', created_at: old, updated_at: old });
    await db.query(`UPDATE users SET full_name = 'Tên mới' WHERE id = $1`, [user['id']]);
    const rows: { updated_at: Date }[] = await db.query(
      'SELECT updated_at FROM users WHERE id = $1',
      [user['id']],
    );
    assert.ok(rows[0] && Date.now() - rows[0].updated_at.getTime() < 60_000);
  });

  it('revert xoá bảng users và extension citext, chạy lại được', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users'`,
    );
    assert.equal(tables.length, 0);
    const extensions: unknown[] = await db.query(
      `SELECT 1 FROM pg_extension WHERE extname = 'citext'`,
    );
    assert.equal(extensions.length, 0);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
