import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import {
  hashRefreshToken,
  INVALID_REFRESH_TOKEN_MESSAGE,
} from '../src/auth/refresh-token.service.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

interface TokenData {
  accessToken: string;
  refreshToken: string;
}

describe('POST /api/v1/auth/logout', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;

  before(async () => {
    await useTestDatabase();
    app = await createApp();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1/auth`;
    db = app.get(DataSource);

    for (const email of ['logout@test.vn', 'other@test.vn']) {
      const registered = await post('/register', {
        companyName: `Công ty ${email}`,
        fullName: 'Logout User',
        email,
        password: PASSWORD,
      });
      assert.equal(registered.status, 201);
    }
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

  async function login(email = 'logout@test.vn'): Promise<TokenData> {
    const response = await post('/login', { identifier: email, password: PASSWORD });
    assert.equal(response.status, 200);
    return ((await response.json()) as { data: TokenData }).data;
  }

  async function revokedAt(refreshToken: string): Promise<Date | null> {
    const [row] = (await db.query('SELECT revoked_at FROM refresh_tokens WHERE token_hash = $1', [
      hashRefreshToken(refreshToken),
    ])) as { revoked_at: Date | null }[];
    assert.ok(row);
    return row.revoked_at;
  }

  it('đăng xuất → 204 không có body, refresh token của phiên bị thu hồi', async () => {
    const tokens = await login();
    const response = await post('/logout', {}, tokens.accessToken);
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
    assert.ok((await revokedAt(tokens.refreshToken)) instanceof Date);

    const refresh = await post('/refresh', { refreshToken: tokens.refreshToken });
    assert.equal(refresh.status, 401);
  });

  it('thu hồi cả token đã xoay vòng trong phiên; phiên khác vẫn dùng được', async () => {
    const session = await login();
    const rotated = (await (
      await post('/refresh', { refreshToken: session.refreshToken })
    ).json()) as {
      data: TokenData;
    };
    const otherSession = await login();
    const otherUser = await login('other@test.vn');

    assert.equal((await post('/logout', {}, rotated.data.accessToken)).status, 204);
    assert.ok((await revokedAt(rotated.data.refreshToken)) instanceof Date);

    assert.equal((await post('/refresh', { refreshToken: otherSession.refreshToken })).status, 200);
    assert.equal((await post('/refresh', { refreshToken: otherUser.refreshToken })).status, 200);
  });

  it('đăng xuất lần nữa vẫn 204', async () => {
    const tokens = await login();
    assert.equal((await post('/logout', {}, tokens.accessToken)).status, 204);
    assert.equal((await post('/logout', {}, tokens.accessToken)).status, 204);
  });

  it('không có access token hoặc token sai → 401', async () => {
    const missing = await post('/logout', {});
    assert.equal(missing.status, 401);
    assert.equal(
      ((await missing.json()) as { error: { code: string } }).error.code,
      'UNAUTHENTICATED',
    );
    assert.equal((await post('/logout', {}, 'khong-phai-jwt')).status, 401);
  });

  it('register/login/refresh vẫn công khai (không cần access token)', async () => {
    const refresh = await post('/refresh', { refreshToken: 'x' });
    assert.equal(refresh.status, 401);
    assert.equal(
      ((await refresh.json()) as { message: string }).message,
      INVALID_REFRESH_TOKEN_MESSAGE,
      'lỗi do refresh token, không phải do thiếu access token',
    );
    const tokens = await login();
    assert.equal((await post('/refresh', { refreshToken: tokens.refreshToken })).status, 200);
  });
});
