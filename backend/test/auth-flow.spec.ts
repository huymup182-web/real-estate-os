import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { COMPANY_ADMIN_ROLE } from '../src/auth/default-roles.js';
import { type MailMessage, MailService } from '../src/mail/mail.service.js';
import { useTestDatabase } from './support/test-database.js';

const EMAIL = 'flow@test.vn';
const OLD_PASSWORD = 'mat-khau-cu-123';
const NEW_PASSWORD = 'mat-khau-moi-456';

interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface MeData {
  user: { id: string; email: string; tenantId: string };
  company: { id: string } | null;
  roles: { code: string }[];
  permissions: { code: string; scope: string }[];
}

/**
 * Hành trình auth đầy đủ qua HTTP thật (TASK-048): đăng ký → đăng nhập → /me → refresh →
 * quên mật khẩu → đặt lại (mọi phiên cũ bị thu hồi) → đăng nhập bằng mật khẩu mới → đăng xuất
 * → công ty bị tạm ngưng thì token còn hạn cũng bị chặn.
 * Các bước phụ thuộc nhau nên chạy tuần tự trong một describe.
 */
describe('Auth flow end-to-end', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  const sent: MailMessage[] = [];

  let userId: string;
  let tenantId: string;
  let firstSession: TokenData;
  let rotated: TokenData;
  let newSession: TokenData;

  before(async () => {
    await useTestDatabase();
    app = await createApp();
    app.useLogger(false);
    app.get(MailService).send = (message: MailMessage): Promise<void> => {
      sent.push(message);
      return Promise.resolve();
    };
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1/auth`;
    db = app.get(DataSource);
  });

  after(async () => {
    await app.close();
  });

  function post(path: string, payload: unknown, accessToken?: string): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  }

  function me(accessToken: string): Promise<Response> {
    return fetch(`${baseUrl}/me`, { headers: { authorization: `Bearer ${accessToken}` } });
  }

  async function login(password: string): Promise<Response> {
    return post('/login', { identifier: EMAIL, password });
  }

  async function dataOf<T>(response: Response): Promise<T> {
    return ((await response.json()) as { data: T }).data;
  }

  it('1. đăng ký công ty mới → 201, user là COMPANY_ADMIN của tenant mới', async () => {
    const response = await post('/register', {
      companyName: 'Công ty Hành Trình',
      fullName: 'Flow User',
      email: EMAIL,
      password: OLD_PASSWORD,
    });
    assert.equal(response.status, 201);
    const data = await dataOf<{ user: { id: string }; company: { id: string } }>(response);
    userId = data.user.id;
    tenantId = data.company.id;
    assert.ok(userId);
    assert.ok(tenantId);
  });

  it('2. đăng nhập → access token + refresh token', async () => {
    const response = await login(OLD_PASSWORD);
    assert.equal(response.status, 200);
    firstSession = await dataOf<TokenData>(response);
    assert.ok(firstSession.accessToken);
    assert.ok(firstSession.refreshToken);
    assert.ok(firstSession.expiresIn > 0);
  });

  it('3. GET /me bằng access token → đúng user, tenant, role COMPANY_ADMIN và có quyền', async () => {
    const response = await me(firstSession.accessToken);
    assert.equal(response.status, 200);
    const data = await dataOf<MeData>(response);
    assert.equal(data.user.id, userId);
    assert.equal(data.user.email, EMAIL);
    assert.equal(data.user.tenantId, tenantId);
    assert.equal(data.company?.id, tenantId);
    assert.deepEqual(
      data.roles.map((role) => role.code),
      [COMPANY_ADMIN_ROLE],
    );
    assert.ok(data.permissions.length > 0);
  });

  it('4. refresh → cặp token mới dùng được, refresh token cũ không dùng lại được', async () => {
    const response = await post('/refresh', { refreshToken: firstSession.refreshToken });
    assert.equal(response.status, 200);
    rotated = await dataOf<TokenData>(response);
    assert.notEqual(rotated.refreshToken, firstSession.refreshToken);
    assert.equal((await me(rotated.accessToken)).status, 200);
  });

  it('5. quên mật khẩu → 200 và email chứa mã 6 số', async () => {
    const response = await post('/forgot-password', { email: EMAIL });
    assert.equal(response.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.to, EMAIL);
  });

  it('6. đặt lại mật khẩu bằng mã → 204, mọi phiên đang có bị thu hồi', async () => {
    const match = /\b(\d{6})\b/.exec(sent.at(-1)?.text ?? '');
    assert.ok(match?.[1]);
    const response = await post('/reset-password', {
      email: EMAIL,
      code: match[1],
      newPassword: NEW_PASSWORD,
    });
    assert.equal(response.status, 204);

    const [row] = (await db.query(
      'SELECT count(*)::int AS active FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    )) as { active: number }[];
    assert.equal(row?.active, 0);
    assert.equal((await post('/refresh', { refreshToken: rotated.refreshToken })).status, 401);
  });

  it('7. mật khẩu cũ bị từ chối, mật khẩu mới đăng nhập được', async () => {
    assert.equal((await login(OLD_PASSWORD)).status, 401);
    const response = await login(NEW_PASSWORD);
    assert.equal(response.status, 200);
    newSession = await dataOf<TokenData>(response);
    assert.equal((await me(newSession.accessToken)).status, 200);
  });

  it('8. đăng xuất → 204, refresh token của phiên không dùng được nữa', async () => {
    assert.equal((await post('/logout', {}, newSession.accessToken)).status, 204);
    assert.equal((await post('/refresh', { refreshToken: newSession.refreshToken })).status, 401);
  });

  it('9. công ty bị tạm ngưng → token còn hạn bị chặn 403 ở mọi route cần đăng nhập', async () => {
    const response = await login(NEW_PASSWORD);
    assert.equal(response.status, 200);
    const session = await dataOf<TokenData>(response);

    await db.query(`UPDATE companies SET status = 'SUSPENDED' WHERE id = $1`, [tenantId]);
    try {
      const blocked = await me(session.accessToken);
      assert.equal(blocked.status, 403);
      const body = (await blocked.json()) as { success: boolean; error: { code: string } };
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'FORBIDDEN');
      assert.equal((await post('/logout', {}, session.accessToken)).status, 403);
    } finally {
      await db.query(`UPDATE companies SET status = 'ACTIVE' WHERE id = $1`, [tenantId]);
    }
    assert.equal((await me(session.accessToken)).status, 200);
  });
});
