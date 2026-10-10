import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { Controller, Get, type INestApplication, Module, Req } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { AppModule } from '../src/app.module.js';
import { ACCESS_TOKEN_TTL_SECONDS } from '../src/auth/access-token.service.js';
import type { AuthenticatedRequest } from '../src/auth/jwt-auth.guard.js';
import { getRequestContext } from '../src/common/logging/request-context.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

/** Route cần đăng nhập, chỉ dùng cho test: trả lại user lấy từ token và request context. */
@Controller('test-protected')
class ProtectedController {
  @Get()
  me(@Req() req: AuthenticatedRequest): unknown {
    const context = getRequestContext();
    return { user: req.user, context: { userId: context?.userId, tenantId: context?.tenantId } };
  }
}

@Module({ imports: [AppModule], controllers: [ProtectedController] })
class TestAppModule {}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('JWT access token', () => {
  let app: INestApplication;
  let baseUrl: string;
  let secret: string;
  let userId: string;
  let companyId: string;
  let accessToken: string;
  let expiresIn: number;
  let sessionId: string;
  let db: DataSource;

  before(async () => {
    await useTestDatabase();
    secret = process.env['JWT_SECRET'] ?? '';
    app = await createApp(TestAppModule);
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    db = app.get(DataSource);

    const registered = (await (
      await post('/auth/register', {
        companyName: 'Công ty Token',
        fullName: 'Token User',
        email: 'token@test.vn',
        password: PASSWORD,
      })
    ).json()) as { data: { user: { id: string }; company: { id: string } } };
    userId = registered.data.user.id;
    companyId = registered.data.company.id;

    const login = (await (
      await post('/auth/login', { identifier: 'token@test.vn', password: PASSWORD })
    ).json()) as { data: { accessToken: string; expiresIn: number } };
    accessToken = login.data.accessToken;
    expiresIn = login.data.expiresIn;
    const [session] = await db.query('SELECT family_id FROM refresh_tokens WHERE user_id = $1', [
      userId,
    ]);
    sessionId = session.family_id;
  });

  after(async () => {
    await app.close();
  });

  function post(path: string, payload: unknown): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async function callProtected(
    authorization?: string,
  ): Promise<{ status: number; body: { data: unknown; error?: { code: string } } }> {
    const response = await fetch(`${baseUrl}/test-protected`, {
      headers: authorization ? { authorization } : {},
    });
    return {
      status: response.status,
      body: (await response.json()) as { data: unknown; error?: { code: string } },
    };
  }

  it('đăng nhập trả access token HS256 sống 15 phút, chỉ chứa user, tenant và phiên', () => {
    assert.equal(expiresIn, ACCESS_TOKEN_TTL_SECONDS);
    assert.equal(ACCESS_TOKEN_TTL_SECONDS, 900);
    const [header, payload] = accessToken.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(header ?? '', 'base64url').toString()), {
      alg: 'HS256',
      typ: 'JWT',
    });
    const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()) as Record<
      string,
      unknown
    >;
    assert.deepEqual(Object.keys(claims).sort(), ['exp', 'iat', 'sid', 'sub', 'tid']);
    assert.equal(claims['sub'], userId);
    assert.equal(claims['tid'], companyId);
    assert.equal(claims['sid'], sessionId);
    assert.equal((claims['exp'] as number) - (claims['iat'] as number), 900);
  });

  it('token hợp lệ → vào được route cần đăng nhập, user và tenant lấy từ token', async () => {
    const result = await callProtected(`Bearer ${accessToken}`);
    assert.equal(result.status, 200);
    const data = result.body.data as {
      user: Record<string, unknown>;
      context: Record<string, unknown>;
    };
    const { roles, permissions, ...fromToken } = data.user;
    assert.deepEqual(fromToken, { userId, tenantId: companyId, sessionId });
    assert.deepEqual(roles, ['COMPANY_ADMIN']);
    assert.equal(typeof permissions, 'object');
    assert.deepEqual(data.context, { userId, tenantId: companyId });
  });

  it('thiếu token hoặc sai dạng header → 401 UNAUTHENTICATED', async () => {
    for (const header of [
      undefined,
      accessToken,
      `Basic ${accessToken}`,
      'Bearer ',
      'Bearer a b',
    ]) {
      const result = await callProtected(header);
      assert.equal(result.status, 401, String(header));
      assert.equal(result.body.error?.code, 'UNAUTHENTICATED');
    }
  });

  it('token giả mạo, ký bằng khoá khác, hoặc alg none → 401', async () => {
    const [header, , signature] = accessToken.split('.');
    const tamperedPayload = base64url({
      sub: userId,
      tid: 'tenant-khac',
      sid: 'x',
      iat: 1,
      exp: 9999999999,
    });
    const otherSecret = await new JwtService({
      secret: 'mot-khoa-khac-du-dai-32-ky-tu-xyz',
    }).signAsync({
      sub: userId,
      tid: companyId,
      sid: sessionId,
    });
    const algNone = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({
      sub: userId,
      tid: companyId,
      sid: sessionId,
      exp: 9999999999,
    })}.`;
    for (const token of [
      `${header}.${tamperedPayload}.${signature}`,
      otherSecret,
      algNone,
      'khong-phai-jwt',
    ]) {
      const result = await callProtected(`Bearer ${token}`);
      assert.equal(result.status, 401, token);
      assert.equal(result.body.error?.code, 'UNAUTHENTICATED');
    }
  });

  it('token hết hạn → 401 TOKEN_EXPIRED', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = await new JwtService({ secret }).signAsync({
      sub: userId,
      tid: companyId,
      sid: sessionId,
      iat: now - 1000,
      exp: now - 10,
    });
    const result = await callProtected(`Bearer ${expired}`);
    assert.equal(result.status, 401);
    assert.equal(result.body.error?.code, 'TOKEN_EXPIRED');
  });

  it('token đúng chữ ký nhưng thiếu sub/tid/sid → 401', async () => {
    const jwt = new JwtService({ secret });
    for (const claims of [
      { tid: companyId, sid: sessionId },
      { sub: userId, sid: sessionId },
      { sub: 5, tid: null, sid: sessionId },
      { sub: userId, tid: companyId },
    ]) {
      const token = await jwt.signAsync(claims, { expiresIn: 60 });
      const result = await callProtected(`Bearer ${token}`);
      assert.equal(result.status, 401, JSON.stringify(claims));
    }
  });

  it('route công khai (health, đăng nhập) không cần token', async () => {
    assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
    const login = await post('/auth/login', { identifier: 'token@test.vn', password: PASSWORD });
    assert.equal(login.status, 200);
  });
});
