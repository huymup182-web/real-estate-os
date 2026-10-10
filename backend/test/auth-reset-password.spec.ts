import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import {
  INVALID_RESET_CODE_MESSAGE,
  RESET_CODE_MAX_ATTEMPTS,
} from '../src/auth/password-reset.service.js';
import { RateLimiter } from '../src/common/rate-limit/rate-limiter.js';
import { type MailMessage, MailService } from '../src/mail/mail.service.js';
import { useTestDatabase } from './support/test-database.js';

const EMAIL = 'reset@test.vn';
const OLD_PASSWORD = 'mat-khau-cu-123';
const NEW_PASSWORD = 'mat-khau-moi-456';

interface ApiError {
  error?: { code: string; details?: { field?: string }[] };
  message: string | null;
}

describe('POST /api/v1/auth/reset-password', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let userId: string;
  let password = OLD_PASSWORD;
  const sent: MailMessage[] = [];

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

    const registered = await post('/register', {
      companyName: 'Công ty Đặt Lại',
      fullName: 'Reset User',
      email: EMAIL,
      password: OLD_PASSWORD,
    });
    assert.equal(registered.status, 201);
    userId = ((await registered.json()) as { data: { user: { id: string } } }).data.user.id;
  });

  after(async () => {
    await app.close();
  });

  beforeEach(() => {
    sent.length = 0;
    // Giới hạn số lần gọi (TASK-155) có test riêng ở security.spec.ts; ở đây mỗi ca bắt đầu từ 0.
    app.get(RateLimiter).clear();
  });

  function post(path: string, payload: unknown): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  /** Xin mã qua forgot-password, lấy mã 6 số từ email đã gửi. */
  async function requestCode(): Promise<string> {
    assert.equal((await post('/forgot-password', { email: EMAIL })).status, 200);
    const match = /\b(\d{6})\b/.exec(sent.at(-1)?.text ?? '');
    assert.ok(match?.[1]);
    return match[1];
  }

  function wrongCodeFor(code: string): string {
    return code === '000000' ? '111111' : '000000';
  }

  async function reset(payload: Record<string, unknown>): Promise<Response> {
    return post('/reset-password', payload);
  }

  async function assertInvalidCode(response: Response): Promise<void> {
    assert.equal(response.status, 400);
    const body = (await response.json()) as ApiError;
    assert.equal(body.error?.code, 'VALIDATION_ERROR');
    assert.equal(body.message, INVALID_RESET_CODE_MESSAGE);
  }

  async function loginStatus(withPassword: string): Promise<number> {
    return (await post('/login', { identifier: EMAIL, password: withPassword })).status;
  }

  it('mã đúng → 204, đổi mật khẩu, thu hồi mọi phiên, mã chỉ dùng một lần', async () => {
    const login = (await (await post('/login', { identifier: EMAIL, password })).json()) as {
      data: { refreshToken: string };
    };

    const code = await requestCode();
    const response = await reset({ email: EMAIL, code, newPassword: NEW_PASSWORD });
    assert.equal(response.status, 204);
    password = NEW_PASSWORD;

    assert.equal(await loginStatus(OLD_PASSWORD), 401);
    assert.equal(await loginStatus(NEW_PASSWORD), 200);
    const refresh = await post('/refresh', { refreshToken: login.data.refreshToken });
    assert.equal(refresh.status, 401, 'phiên cũ bị thu hồi');

    await assertInvalidCode(await reset({ email: EMAIL, code, newPassword: 'mat-khau-khac-789' }));
    assert.equal(await loginStatus(NEW_PASSWORD), 200);
  });

  it('mã sai → 400 và tăng attempts; sai đủ 5 lần thì huỷ mã, mã đúng cũng không dùng được', async () => {
    const code = await requestCode();
    for (let i = 1; i <= RESET_CODE_MAX_ATTEMPTS; i += 1) {
      await assertInvalidCode(
        await reset({ email: EMAIL, code: wrongCodeFor(code), newPassword: 'mat-khau-khac-789' }),
      );
    }
    const [row] = (await db.query(
      `SELECT attempts, used_at FROM password_reset_tokens
        WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId],
    )) as { attempts: number; used_at: Date | null }[];
    assert.equal(row?.attempts, RESET_CODE_MAX_ATTEMPTS);
    assert.ok(row?.used_at instanceof Date);

    await assertInvalidCode(await reset({ email: EMAIL, code, newPassword: 'mat-khau-khac-789' }));
    assert.equal(await loginStatus(password), 200, 'mật khẩu không đổi');
  });

  it('sai ít hơn 5 lần vẫn dùng được mã đúng', async () => {
    const code = await requestCode();
    await assertInvalidCode(
      await reset({ email: EMAIL, code: wrongCodeFor(code), newPassword: 'mat-khau-khac-789' }),
    );
    assert.equal((await reset({ email: EMAIL, code, newPassword: NEW_PASSWORD })).status, 204);
  });

  it('chỉ mã mới nhất dùng được; mã hết hạn bị từ chối', async () => {
    const oldCode = await requestCode();
    const newCode = await requestCode();
    if (oldCode !== newCode) {
      await assertInvalidCode(
        await reset({ email: EMAIL, code: oldCode, newPassword: NEW_PASSWORD }),
      );
    }

    await db.query(
      `UPDATE password_reset_tokens
          SET created_at = now() - interval '20 minutes', expires_at = now() - interval '5 minutes'
        WHERE user_id = $1 AND used_at IS NULL`,
      [userId],
    );
    await assertInvalidCode(
      await reset({ email: EMAIL, code: newCode, newPassword: NEW_PASSWORD }),
    );
  });

  it('email không có tài khoản hoặc tài khoản bị khoá → cùng lỗi 400', async () => {
    await assertInvalidCode(
      await reset({ email: 'khong-ai@test.vn', code: '123456', newPassword: NEW_PASSWORD }),
    );
    const code = await requestCode();
    await db.query(`UPDATE users SET status = 'LOCKED' WHERE id = $1`, [userId]);
    try {
      await assertInvalidCode(await reset({ email: EMAIL, code, newPassword: NEW_PASSWORD }));
    } finally {
      await db.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [userId]);
    }
  });

  it('dữ liệu sai: mã không phải 6 số, mật khẩu ngắn, thiếu trường, trường lạ → 400', async () => {
    const cases: [Record<string, unknown>, string[]][] = [
      [{ email: EMAIL, code: '12345', newPassword: NEW_PASSWORD }, ['code']],
      [{ email: EMAIL, code: 'abcdef', newPassword: NEW_PASSWORD }, ['code']],
      [{ email: EMAIL, code: '123456', newPassword: 'ngan' }, ['newPassword']],
      [{}, ['code', 'email', 'newPassword']],
    ];
    for (const [payload, fields] of cases) {
      const response = await reset(payload);
      assert.equal(response.status, 400, JSON.stringify(payload));
      const body = (await response.json()) as ApiError;
      const actual = [...new Set((body.error?.details ?? []).map((d) => d.field))].sort();
      assert.deepEqual(actual, fields, JSON.stringify(payload));
    }
    const extra = await reset({ email: EMAIL, code: '123456', newPassword: NEW_PASSWORD, userId });
    assert.equal(extra.status, 400);
  });
});
