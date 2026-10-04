import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { INVALID_CREDENTIALS_MESSAGE } from '../src/auth/login.service.js';
import { hash } from '@node-rs/argon2';

import { ARGON2_OPTIONS, hashPassword, needsRehash, verifyPassword } from '../src/auth/password.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

interface ApiBody {
  success: boolean;
  message: string | null;
  data: {
    accessToken?: string;
    expiresIn?: number;
    user: {
      id: string;
      tenantId: string | null;
      fullName: string;
      email: string | null;
      phone: string | null;
    };
  } | null;
  error?: { code: string; details?: { field?: string }[] };
}

describe('POST /api/v1/auth/login', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let userId: string;
  let companyId: string;

  before(async () => {
    await useTestDatabase();
    app = await createApp();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1/auth`;
    db = app.get(DataSource);

    const registered = await post('/register', {
      companyName: 'Công ty Đăng Nhập',
      fullName: 'Lê Văn Login',
      email: 'login@test.vn',
      phone: '+84902000001',
      password: PASSWORD,
    });
    assert.equal(registered.status, 201);
    const data = registered.body.data as unknown as {
      user: { id: string };
      company: { id: string };
    };
    userId = data.user.id;
    companyId = data.company.id;
  });

  after(async () => {
    await app.close();
  });

  async function post(
    path: string,
    payload: Record<string, unknown>,
  ): Promise<{ status: number; body: ApiBody; raw: string }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const raw = await response.text();
    return { status: response.status, body: JSON.parse(raw) as ApiBody, raw };
  }

  const login = (identifier: string, password = PASSWORD): ReturnType<typeof post> =>
    post('/login', { identifier, password });

  function assertInvalidCredentials(result: { status: number; body: ApiBody }): void {
    assert.equal(result.status, 401);
    assert.equal(result.body.error?.code, 'UNAUTHENTICATED');
    assert.equal(result.body.message, INVALID_CREDENTIALS_MESSAGE);
  }

  it('đăng nhập bằng email (không phân biệt hoa thường) → 200, ghi last_login_at', async () => {
    const result = await login('  LOGIN@Test.VN ');
    assert.equal(result.status, 200);
    const { accessToken, expiresIn, ...rest } = result.body.data ?? {};
    assert.equal(typeof accessToken, 'string');
    assert.equal(expiresIn, 900);
    assert.deepEqual(rest, {
      user: {
        id: userId,
        tenantId: companyId,
        fullName: 'Lê Văn Login',
        email: 'login@test.vn',
        phone: '+84902000001',
      },
    });
    assert.ok(!/password|argon2|mat-khau/i.test(result.raw));
    const [row] = await db.query('SELECT last_login_at FROM users WHERE id = $1', [userId]);
    assert.ok(row.last_login_at instanceof Date);
  });

  it('đăng nhập bằng số điện thoại', async () => {
    const result = await login('+84902000001');
    assert.equal(result.status, 200);
    assert.equal(result.body.data?.user.id, userId);
  });

  it('sai mật khẩu và tài khoản không tồn tại trả cùng một lỗi 401', async () => {
    const wrongPassword = await login('login@test.vn', 'sai-mat-khau');
    const unknownEmail = await login('khong-ai@test.vn');
    const unknownPhone = await login('+84999999999');
    for (const result of [wrongPassword, unknownEmail, unknownPhone]) {
      assertInvalidCredentials(result);
    }
  });

  it('tài khoản bị khoá: đúng mật khẩu → 403, sai mật khẩu vẫn 401', async () => {
    await db.query(`UPDATE users SET status = 'LOCKED' WHERE id = $1`, [userId]);
    try {
      const locked = await login('login@test.vn');
      assert.equal(locked.status, 403);
      assert.equal(locked.body.error?.code, 'FORBIDDEN');
      assertInvalidCredentials(await login('login@test.vn', 'sai-mat-khau'));
    } finally {
      await db.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [userId]);
    }
  });

  it('công ty bị tạm ngưng → 403', async () => {
    await db.query(`UPDATE companies SET status = 'SUSPENDED' WHERE id = $1`, [companyId]);
    try {
      const result = await login('login@test.vn');
      assert.equal(result.status, 403);
      assert.equal(result.body.message, 'Công ty đang bị tạm ngưng');
    } finally {
      await db.query(`UPDATE companies SET status = 'ACTIVE' WHERE id = $1`, [companyId]);
    }
  });

  it('tài khoản đã xoá mềm không đăng nhập được', async () => {
    await db.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [userId]);
    try {
      assertInvalidCredentials(await login('login@test.vn'));
    } finally {
      await db.query(`UPDATE users SET deleted_at = NULL WHERE id = $1`, [userId]);
    }
  });

  it('mật khẩu băm bằng tham số cũ được băm lại khi đăng nhập thành công', async () => {
    const weakHash = await hash(PASSWORD, { ...ARGON2_OPTIONS, timeCost: 1 });
    await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, weakHash]);
    assert.equal((await login('login@test.vn', 'sai-mat-khau')).status, 401);
    const [afterFailure] = await db.query('SELECT password_hash FROM users WHERE id = $1', [
      userId,
    ]);
    assert.equal(afterFailure.password_hash, weakHash, 'sai mật khẩu thì không đổi gì');

    assert.equal((await login('login@test.vn')).status, 200);
    const [row] = await db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    assert.notEqual(row.password_hash, weakHash);
    assert.equal(needsRehash(row.password_hash), false);
    assert.equal(await verifyPassword(row.password_hash, PASSWORD), true);
  });

  it('tài khoản nền tảng (không thuộc công ty) đăng nhập được', async () => {
    const passwordHash = await hashPassword(PASSWORD);
    await db.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES (NULL, $1, $2, $3)`,
      ['platform@test.vn', passwordHash, 'Quản trị nền tảng'],
    );
    const result = await login('platform@test.vn');
    assert.equal(result.status, 200);
    assert.equal(result.body.data?.user.tenantId, null);
  });

  it('thiếu trường hoặc có trường lạ → 400', async () => {
    const missing = await post('/login', { identifier: '   ', password: '' });
    assert.equal(missing.status, 400);
    assert.deepEqual((missing.body.error?.details ?? []).map((d) => d.field).sort(), [
      'identifier',
      'password',
    ]);
    const extra = await post('/login', {
      identifier: 'login@test.vn',
      password: PASSWORD,
      tenantId: 'x',
    });
    assert.equal(extra.status, 400);
  });
});

describe('verifyPassword', () => {
  it('đúng/sai mật khẩu; chuỗi băm hỏng coi như sai', async () => {
    const passwordHash = await hashPassword(PASSWORD);
    assert.equal(await verifyPassword(passwordHash, PASSWORD), true);
    assert.equal(await verifyPassword(passwordHash, 'khac'), false);
    assert.equal(await verifyPassword('khong-phai-chuoi-bam', PASSWORD), false);
  });
});
