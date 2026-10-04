import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadAppConfig } from '../src/config/app-config.js';

const DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/real_estate_os';
const JWT_SECRET = 'khoa-test-du-dai-it-nhat-32-ky-tu-abc';

describe('loadAppConfig', () => {
  it('mặc định cổng 3000, môi trường development', () => {
    assert.deepEqual(loadAppConfig({ DATABASE_URL, JWT_SECRET }), {
      port: 3000,
      nodeEnv: 'development',
      databaseUrl: DATABASE_URL,
      logLevel: 'log',
      jwtSecret: JWT_SECRET,
      mail: null,
    });
  });

  it('đọc PORT và NODE_ENV hợp lệ', () => {
    const config = loadAppConfig({
      PORT: '8080',
      NODE_ENV: 'production',
      DATABASE_URL,
      JWT_SECRET,
      SMTP_HOST: 'smtp.example.com',
      MAIL_FROM: 'no-reply@example.com',
    });
    assert.equal(config.port, 8080);
    assert.equal(config.nodeEnv, 'production');
  });

  it('từ chối PORT sai', () => {
    for (const port of ['abc', '0', '65536', '30.5', '-1', '']) {
      assert.throws(
        () => loadAppConfig({ PORT: port, DATABASE_URL, JWT_SECRET }),
        /PORT không hợp lệ/,
        port,
      );
    }
  });

  it('từ chối NODE_ENV lạ', () => {
    assert.throws(
      () => loadAppConfig({ NODE_ENV: 'staging', DATABASE_URL, JWT_SECRET }),
      /NODE_ENV không hợp lệ/,
    );
  });

  it('bắt buộc DATABASE_URL đúng dạng PostgreSQL', () => {
    assert.throws(() => loadAppConfig({ JWT_SECRET }), /Thiếu DATABASE_URL/);
    for (const url of [
      'not-a-url',
      'mysql://u:p@localhost:3306/db',
      'postgresql://u:p@localhost:5432',
    ]) {
      assert.throws(
        () => loadAppConfig({ DATABASE_URL: url, JWT_SECRET }),
        /DATABASE_URL không hợp lệ/,
        url,
      );
    }
    assert.equal(
      loadAppConfig({ DATABASE_URL: 'postgres://u:p@db:5432/x', JWT_SECRET }).databaseUrl,
      'postgres://u:p@db:5432/x',
    );
  });

  it('đọc LOG_LEVEL hợp lệ, từ chối giá trị lạ', () => {
    assert.equal(loadAppConfig({ LOG_LEVEL: 'debug', DATABASE_URL, JWT_SECRET }).logLevel, 'debug');
    for (const level of ['info', 'LOG', '']) {
      assert.throws(
        () => loadAppConfig({ LOG_LEVEL: level, DATABASE_URL, JWT_SECRET }),
        /LOG_LEVEL không hợp lệ/,
        level,
      );
    }
  });

  it('bắt buộc JWT_SECRET đủ dài; production không dùng khoá dev', () => {
    assert.throws(() => loadAppConfig({ DATABASE_URL }), /Thiếu JWT_SECRET/);
    assert.throws(
      () => loadAppConfig({ DATABASE_URL, JWT_SECRET: 'ngan-qua' }),
      /JWT_SECRET phải có ít nhất 32 ký tự/,
    );
    const devSecret = 'dev-only-insecure-jwt-secret-change-me';
    assert.equal(loadAppConfig({ DATABASE_URL, JWT_SECRET: devSecret }).jwtSecret, devSecret);
    assert.throws(
      () => loadAppConfig({ DATABASE_URL, JWT_SECRET: devSecret, NODE_ENV: 'production' }),
      /khoá dev/,
    );
  });

  it('đọc cấu hình SMTP; mặc định cổng 587, không TLS ngay từ đầu, không đăng nhập', () => {
    const base = { DATABASE_URL, JWT_SECRET, SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'a@b.vn' };
    assert.deepEqual(loadAppConfig(base).mail, {
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      user: null,
      password: null,
      from: 'a@b.vn',
    });
    assert.deepEqual(
      loadAppConfig({
        ...base,
        SMTP_PORT: '465',
        SMTP_SECURE: 'true',
        SMTP_USER: 'user',
        SMTP_PASSWORD: 'secret',
      }).mail,
      {
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        user: 'user',
        password: 'secret',
        from: 'a@b.vn',
      },
    );
  });

  it('SMTP: bắt buộc ở production, từ chối cấu hình sai', () => {
    assert.throws(
      () => loadAppConfig({ DATABASE_URL, JWT_SECRET, NODE_ENV: 'production' }),
      /Thiếu SMTP_HOST/,
    );
    const base = { DATABASE_URL, JWT_SECRET, SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'a@b.vn' };
    assert.throws(() => loadAppConfig({ ...base, MAIL_FROM: '' }), /Thiếu MAIL_FROM/);
    assert.throws(() => loadAppConfig({ ...base, SMTP_PORT: 'abc' }), /SMTP_PORT không hợp lệ/);
    assert.throws(() => loadAppConfig({ ...base, SMTP_SECURE: 'yes' }), /SMTP_SECURE không hợp lệ/);
    assert.throws(
      () => loadAppConfig({ ...base, SMTP_USER: 'user' }),
      /SMTP_USER và SMTP_PASSWORD/,
    );
  });
});
