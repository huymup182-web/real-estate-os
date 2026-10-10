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
  REFRESH_TOKEN_TTL_SECONDS,
} from '../src/auth/refresh-token.service.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface ApiResult {
  status: number;
  body: { data: TokenData | null; message: string | null; error?: { code: string } };
  raw: string;
}

interface TokenRow {
  id: string;
  family_id: string;
  token_hash: string;
  device_info: string | null;
  ip_address: string | null;
  expires_at: Date;
  created_at: Date;
  revoked_at: Date | null;
  replaced_by: string | null;
}

function claimsOf(accessToken: string): Record<string, unknown> {
  const payload = accessToken.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>;
}

describe('POST /api/v1/auth/refresh', () => {
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
      companyName: 'Công ty Refresh',
      fullName: 'Refresh User',
      email: 'refresh@test.vn',
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
    headers: Record<string, string> = {},
  ): Promise<ApiResult> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
    const raw = await response.text();
    return { status: response.status, body: JSON.parse(raw) as ApiResult['body'], raw };
  }

  async function login(): Promise<TokenData> {
    const result = await post(
      '/login',
      { identifier: 'refresh@test.vn', password: PASSWORD },
      { 'user-agent': 'RealEstateApp/1.0 (Android 14)' },
    );
    assert.equal(result.status, 200);
    assert.ok(result.body.data);
    return result.body.data;
  }

  const refresh = (refreshToken: unknown): Promise<ApiResult> => post('/refresh', { refreshToken });

  async function tokenRow(refreshToken: string): Promise<TokenRow> {
    const [row] = (await db.query(
      `SELECT id, family_id, token_hash, device_info, host(ip_address) AS ip_address,
              expires_at, created_at, revoked_at, replaced_by
         FROM refresh_tokens WHERE token_hash = $1`,
      [hashRefreshToken(refreshToken)],
    )) as TokenRow[];
    assert.ok(row, 'phải có dòng refresh_tokens');
    return row;
  }

  function assertInvalid(result: ApiResult): void {
    assert.equal(result.status, 401);
    assert.equal(result.body.error?.code, 'UNAUTHENTICATED');
    assert.equal(result.body.message, INVALID_REFRESH_TOKEN_MESSAGE);
  }

  it('đăng nhập lưu phiên: chỉ lưu hash, sống 30 ngày, có thiết bị và IP; sid = family', async () => {
    const tokens = await login();
    assert.match(tokens.refreshToken, /^[A-Za-z0-9_-]{43}$/);
    const row = await tokenRow(tokens.refreshToken);
    assert.notEqual(row.token_hash, tokens.refreshToken);
    const stored: unknown[] = await db.query('SELECT 1 FROM refresh_tokens WHERE token_hash = $1', [
      tokens.refreshToken,
    ]);
    assert.equal(stored.length, 0, 'không lưu token gốc');
    assert.equal(row.device_info, 'RealEstateApp/1.0 (Android 14)');
    assert.equal(row.ip_address, '127.0.0.1');
    assert.equal(
      (row.expires_at.getTime() - row.created_at.getTime()) / 1000,
      REFRESH_TOKEN_TTL_SECONDS,
    );
    assert.equal(claimsOf(tokens.accessToken)['sid'], row.family_id);
  });

  it('refresh → cặp token mới cùng phiên; token cũ bị thu hồi và trỏ tới token mới', async () => {
    const first = await login();
    const result = await refresh(first.refreshToken);
    assert.equal(result.status, 200);
    const next = result.body.data;
    assert.ok(next);
    assert.deepEqual(Object.keys(next).sort(), ['accessToken', 'expiresIn', 'refreshToken']);
    assert.equal(next.expiresIn, 900);
    assert.notEqual(next.refreshToken, first.refreshToken);

    const oldRow = await tokenRow(first.refreshToken);
    const newRow = await tokenRow(next.refreshToken);
    assert.ok(oldRow.revoked_at instanceof Date);
    assert.equal(oldRow.replaced_by, newRow.id);
    assert.equal(newRow.revoked_at, null);
    assert.equal(newRow.family_id, oldRow.family_id);

    const claims = claimsOf(next.accessToken);
    assert.equal(claims['sub'], userId);
    assert.equal(claims['tid'], companyId);
    assert.equal(claims['sid'], oldRow.family_id);

    // Access token mới dùng được, token mới tiếp tục xoay vòng được.
    assert.equal((await refresh(next.refreshToken)).status, 200);
  });

  it('dùng lại token đã bị thay thế → 401 và thu hồi cả phiên', async () => {
    const first = await login();
    const second = (await refresh(first.refreshToken)).body.data;
    assert.ok(second);
    const third = (await refresh(second.refreshToken)).body.data;
    assert.ok(third);

    assertInvalid(await refresh(first.refreshToken));
    const { family_id: familyId } = await tokenRow(first.refreshToken);
    const active: unknown[] = await db.query(
      'SELECT 1 FROM refresh_tokens WHERE family_id = $1 AND revoked_at IS NULL',
      [familyId],
    );
    assert.equal(active.length, 0, 'mọi token của phiên đều bị thu hồi');
    assertInvalid(await refresh(third.refreshToken));

    // Phiên khác của cùng user không bị ảnh hưởng.
    const other = await login();
    assert.equal((await refresh(other.refreshToken)).status, 200);
  });

  it('token không tồn tại, hết hạn hoặc đã thu hồi → 401', async () => {
    assertInvalid(await refresh('khong-ton-tai'));

    const expired = await login();
    await db.query(
      `UPDATE refresh_tokens SET created_at = now() - interval '31 days',
                                 expires_at = now() - interval '1 day'
        WHERE token_hash = $1`,
      [hashRefreshToken(expired.refreshToken)],
    );
    assertInvalid(await refresh(expired.refreshToken));

    const revoked = await login();
    await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [
      hashRefreshToken(revoked.refreshToken),
    ]);
    assertInvalid(await refresh(revoked.refreshToken));
  });

  it('tài khoản bị khoá hoặc công ty tạm ngưng → 403, token vẫn chưa bị dùng', async () => {
    const tokens = await login();
    await db.query(`UPDATE users SET status = 'LOCKED' WHERE id = $1`, [userId]);
    try {
      const locked = await refresh(tokens.refreshToken);
      assert.equal(locked.status, 403);
      assert.equal(locked.body.error?.code, 'FORBIDDEN');
    } finally {
      await db.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [userId]);
    }
    await db.query(`UPDATE companies SET status = 'SUSPENDED' WHERE id = $1`, [companyId]);
    try {
      const suspended = await refresh(tokens.refreshToken);
      assert.equal(suspended.status, 403);
      assert.equal(suspended.body.message, 'Công ty đang bị tạm ngưng');
    } finally {
      await db.query(`UPDATE companies SET status = 'ACTIVE' WHERE id = $1`, [companyId]);
    }
    assert.equal((await tokenRow(tokens.refreshToken)).revoked_at, null);
  });

  it('user đã xoá mềm → 401', async () => {
    const tokens = await login();
    await db.query('UPDATE users SET deleted_at = now() WHERE id = $1', [userId]);
    try {
      assertInvalid(await refresh(tokens.refreshToken));
    } finally {
      await db.query('UPDATE users SET deleted_at = NULL WHERE id = $1', [userId]);
    }
  });

  it('thiếu refreshToken, sai kiểu hoặc có trường lạ → 400', async () => {
    for (const payload of [{}, { refreshToken: '' }, { refreshToken: 5 }]) {
      const result = await post('/refresh', payload);
      assert.equal(result.status, 400, JSON.stringify(payload));
      assert.equal(result.body.error?.code, 'VALIDATION_ERROR');
    }
    const extra = await post('/refresh', { refreshToken: 'x', userId });
    assert.equal(extra.status, 400);
  });
});
