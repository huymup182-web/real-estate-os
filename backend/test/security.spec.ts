import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';

import { createApp } from '../src/app.factory.js';
import { AUTH_RATE_LIMITS } from '../src/auth/auth-rate-limits.js';
import { RateLimitedException, RateLimiter } from '../src/common/rate-limit/rate-limiter.js';
import { SECURITY_HEADERS } from '../src/common/security/security-headers.js';
import { MailService } from '../src/mail/mail.service.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

/** RateLimiter với đồng hồ tua được. */
class ManualClockLimiter extends RateLimiter {
  time = 1_000_000;

  protected override now(): number {
    return this.time;
  }
}

describe('TASK-155: RateLimiter', () => {
  const rule = { name: 'thu', limit: 3, windowSeconds: 60 };

  it('chặn khi tới giới hạn, mở lại khi hết cửa sổ; check không đếm', () => {
    const limiter = new ManualClockLimiter();
    for (let i = 0; i < 5; i += 1) {
      limiter.check(rule, 'a');
    }
    for (let i = 0; i < 3; i += 1) {
      limiter.consume(rule, 'a');
    }
    assert.throws(
      () => limiter.consume(rule, 'a'),
      (error: unknown) => error instanceof RateLimitedException && error.retryAfterSeconds === 60,
    );
    // Khoá khác không bị ảnh hưởng.
    limiter.consume(rule, 'b');
    limiter.time += 30_000;
    assert.throws(
      () => limiter.check(rule, 'a'),
      (error: unknown) => error instanceof RateLimitedException && error.retryAfterSeconds === 30,
    );
    limiter.time += 30_000;
    limiter.consume(rule, 'a');
  });

  it('reset xoá bộ đếm của khoá', () => {
    const limiter = new ManualClockLimiter();
    for (let i = 0; i < 3; i += 1) {
      limiter.hit(rule, 'a');
    }
    assert.throws(() => limiter.check(rule, 'a'), RateLimitedException);
    limiter.reset(rule, 'a');
    limiter.check(rule, 'a');
  });
});

describe('TASK-155: bảo mật HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;

  before(async () => {
    await useTestDatabase();
    app = await createApp();
    app.useLogger(false);
    app.get(MailService).send = () => Promise.resolve();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
    for (const email of ['bao-mat-1@test.vn', 'bao-mat-2@test.vn']) {
      const response = await post('/auth/register', {
        companyName: `Công ty ${email}`,
        fullName: 'Bảo Mật',
        email,
        password: PASSWORD,
      });
      assert.equal(response.status, 201);
    }
  });

  after(async () => {
    await app.close();
  });

  function post(path: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('mọi response có header bảo mật, không có X-Powered-By, không bật CORS', async () => {
    for (const response of [
      await fetch(`${baseUrl}/health`, { headers: { origin: 'https://evil.example' } }),
      await fetch(`${baseUrl}/khong-co-route-nay`),
      await post('/auth/login', { identifier: 'bao-mat-1@test.vn' }),
    ]) {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        assert.equal(response.headers.get(name), value, name);
      }
      assert.equal(response.headers.get('x-powered-by'), null);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
      // Ngoài production không gửi HSTS (dev chạy HTTP).
      assert.equal(response.headers.get('strict-transport-security'), null);
    }
  });

  it('đăng nhập sai quá 10 lần một tài khoản → 429 kể cả khi đúng mật khẩu; tài khoản khác vẫn vào được', async () => {
    const limit = AUTH_RATE_LIMITS.loginFailuresPerAccount.limit;
    // Đăng nhập đúng xoá các lần sai trước đó của tài khoản.
    for (let i = 0; i < limit - 1; i += 1) {
      const wrong = await post('/auth/login', { identifier: 'bao-mat-1@test.vn', password: 'sai' });
      assert.equal(wrong.status, 401);
    }
    assert.equal(
      (await post('/auth/login', { identifier: 'bao-mat-1@test.vn', password: PASSWORD })).status,
      200,
    );
    for (let i = 0; i < limit; i += 1) {
      const wrong = await post('/auth/login', { identifier: 'BAO-MAT-1@test.vn', password: 'sai' });
      assert.equal(wrong.status, 401);
    }
    const blocked = await post('/auth/login', {
      identifier: 'bao-mat-1@test.vn',
      password: PASSWORD,
    });
    assert.equal(blocked.status, 429);
    const body = (await blocked.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'RATE_LIMITED');
    const retryAfter = Number(blocked.headers.get('retry-after'));
    assert.ok(
      retryAfter > 0 && retryAfter <= AUTH_RATE_LIMITS.loginFailuresPerAccount.windowSeconds,
    );

    assert.equal(
      (await post('/auth/login', { identifier: 'bao-mat-2@test.vn', password: PASSWORD })).status,
      200,
    );
  });

  it('quên mật khẩu tối đa 5 lần mỗi email trong 15 phút, email khác không bị ảnh hưởng', async () => {
    const limit = AUTH_RATE_LIMITS.forgotPerEmail.limit;
    for (let i = 0; i < limit; i += 1) {
      assert.equal(
        (await post('/auth/forgot-password', { email: 'bao-mat-2@test.vn' })).status,
        200,
      );
    }
    assert.equal((await post('/auth/forgot-password', { email: 'bao-mat-2@test.vn' })).status, 429);
    // Email không có tài khoản cũng bị đếm như nhau (không lộ email nào có tài khoản).
    assert.equal((await post('/auth/forgot-password', { email: 'khong-co@test.vn' })).status, 200);
  });

  it('đặt lại mật khẩu tối đa 10 lần mỗi email trong 15 phút', async () => {
    const limit = AUTH_RATE_LIMITS.resetPerEmail.limit;
    const attempt = { email: 'bao-mat-2@test.vn', code: '000000', newPassword: 'mat-khau-moi-9' };
    for (let i = 0; i < limit; i += 1) {
      assert.equal((await post('/auth/reset-password', attempt)).status, 400);
    }
    assert.equal((await post('/auth/reset-password', attempt)).status, 429);
  });
});

describe('TASK-155: giới hạn theo IP khi chạy sau proxy (TRUST_PROXY_HOPS)', () => {
  let app: INestApplication;
  let baseUrl: string;
  const previous = process.env['TRUST_PROXY_HOPS'];

  before(async () => {
    await useTestDatabase();
    process.env['TRUST_PROXY_HOPS'] = '1';
    app = await createApp();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  });

  after(async () => {
    await app.close();
    if (previous === undefined) {
      delete process.env['TRUST_PROXY_HOPS'];
    } else {
      process.env['TRUST_PROXY_HOPS'] = previous;
    }
  });

  function login(forwardedFor: string, identifier: string): Promise<Response> {
    return fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedFor },
      body: JSON.stringify({ identifier, password: 'sai' }),
    });
  }

  it('mỗi IP trong X-Forwarded-For đếm riêng', async () => {
    const limit = AUTH_RATE_LIMITS.loginFailuresPerIp.limit;
    // Mỗi tài khoản sai dưới giới hạn tài khoản, để chỉ giới hạn IP chặn.
    for (let i = 0; i < limit; i += 1) {
      assert.equal((await login('203.0.113.7', `ip-${i % 10}@test.vn`)).status, 401);
    }
    assert.equal((await login('203.0.113.7', 'ip-moi@test.vn')).status, 429);
    assert.equal((await login('203.0.113.8', 'ip-moi@test.vn')).status, 401);
  });
});
