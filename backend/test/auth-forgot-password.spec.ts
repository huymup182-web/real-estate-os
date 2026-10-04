import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { hashResetCode, RESET_CODE_TTL_SECONDS } from '../src/auth/password-reset.service.js';
import { type MailMessage, MailService } from '../src/mail/mail.service.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

interface ResetRow {
  code_hash: string;
  attempts: number;
  expires_at: Date;
  created_at: Date;
  used_at: Date | null;
}

describe('POST /api/v1/auth/forgot-password', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let userId: string;
  let companyId: string;
  const sent: MailMessage[] = [];

  before(async () => {
    await useTestDatabase();
    app = await createApp();
    app.useLogger(false);
    // Không gửi email thật trong test: ghi lại thư thay vì gửi qua SMTP.
    app.get(MailService).send = (message: MailMessage): Promise<void> => {
      sent.push(message);
      return Promise.resolve();
    };
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1/auth`;
    db = app.get(DataSource);

    const registered = await post('/register', {
      companyName: 'Công ty Quên Mật Khẩu',
      fullName: 'Forgot User',
      email: 'forgot@test.vn',
      password: PASSWORD,
    });
    assert.equal(registered.status, 201);
    const data = (
      (await registered.json()) as {
        data: { user: { id: string }; company: { id: string } };
      }
    ).data;
    userId = data.user.id;
    companyId = data.company.id;
  });

  after(async () => {
    await app.close();
  });

  beforeEach(() => {
    sent.length = 0;
  });

  function post(path: string, payload: unknown): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async function forgot(email: unknown): Promise<{ status: number; body: unknown }> {
    const response = await post('/forgot-password', { email });
    return { status: response.status, body: await response.json() };
  }

  async function resetRows(): Promise<ResetRow[]> {
    return (await db.query(
      `SELECT code_hash, attempts, expires_at, created_at, used_at
         FROM password_reset_tokens WHERE user_id = $1 ORDER BY created_at, id`,
      [userId],
    )) as ResetRow[];
  }

  function codeFrom(message: MailMessage | undefined): string {
    const match = /\b(\d{6})\b/.exec(message?.text ?? '');
    assert.ok(match?.[1], 'email phải chứa mã 6 số');
    return match[1];
  }

  const GENERIC_BODY = {
    success: true,
    data: { expiresIn: RESET_CODE_TTL_SECONDS },
    message: null,
  };

  it('email có tài khoản → 200, gửi mã 6 số, DB chỉ lưu hash, sống 15 phút', async () => {
    const result = await forgot('  FORGOT@test.vn ');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, GENERIC_BODY);

    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.to, 'forgot@test.vn');
    const code = codeFrom(sent[0]);
    const rows = await resetRows();
    const latest = rows.at(-1);
    assert.ok(latest);
    assert.equal(latest.code_hash, hashResetCode(userId, code));
    assert.notEqual(latest.code_hash, code);
    assert.equal(latest.attempts, 0);
    assert.equal(latest.used_at, null);
    assert.equal(
      (latest.expires_at.getTime() - latest.created_at.getTime()) / 1000,
      RESET_CODE_TTL_SECONDS,
    );
  });

  it('yêu cầu mã mới làm mã cũ hết hiệu lực', async () => {
    await forgot('forgot@test.vn');
    await forgot('forgot@test.vn');
    const rows = await resetRows();
    const active = rows.filter((row) => row.used_at === null);
    assert.equal(active.length, 1);
    assert.equal(active[0]?.code_hash, hashResetCode(userId, codeFrom(sent.at(-1))));
  });

  it('email không có tài khoản → cùng kết quả, không gửi email', async () => {
    const result = await forgot('khong-ai@test.vn');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, GENERIC_BODY);
    assert.equal(sent.length, 0);
  });

  it('tài khoản khoá, đã xoá hoặc công ty tạm ngưng → cùng kết quả, không gửi email', async () => {
    const cases: [string, string, string][] = [
      [
        `UPDATE users SET status = 'LOCKED' WHERE id = $1`,
        `UPDATE users SET status = 'ACTIVE' WHERE id = $1`,
        userId,
      ],
      [
        `UPDATE users SET deleted_at = now() WHERE id = $1`,
        `UPDATE users SET deleted_at = NULL WHERE id = $1`,
        userId,
      ],
      [
        `UPDATE companies SET status = 'SUSPENDED' WHERE id = $1`,
        `UPDATE companies SET status = 'ACTIVE' WHERE id = $1`,
        companyId,
      ],
    ];
    for (const [apply, restore, id] of cases) {
      await db.query(apply, [id]);
      try {
        const result = await forgot('forgot@test.vn');
        assert.deepEqual(result.body, GENERIC_BODY, apply);
      } finally {
        await db.query(restore, [id]);
      }
    }
    assert.equal(sent.length, 0);
  });

  it('gửi email lỗi vẫn trả kết quả chung (lỗi chỉ ghi log)', async () => {
    const mail = app.get(MailService);
    const original = mail.send;
    mail.send = (): Promise<void> => Promise.reject(new Error('SMTP down'));
    try {
      const result = await forgot('forgot@test.vn');
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, GENERIC_BODY);
    } finally {
      mail.send = original;
    }
  });

  it('email sai định dạng, thiếu email hoặc có trường lạ → 400', async () => {
    for (const payload of [{}, { email: 'khong-phai-email' }, { email: 5 }]) {
      const response = await post('/forgot-password', payload);
      assert.equal(response.status, 400, JSON.stringify(payload));
    }
    const extra = await post('/forgot-password', { email: 'forgot@test.vn', userId });
    assert.equal(extra.status, 400);
  });
});
