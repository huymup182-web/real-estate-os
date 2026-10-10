import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { generateKeyPairSync } from 'node:crypto';

import { loadAppConfig } from '../src/config/app-config.js';

const DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/real_estate_os';
const JWT_SECRET = 'khoa-test-du-dai-it-nhat-32-ky-tu-abc';
const STORAGE = {
  STORAGE_BUCKET: 'anh-bds',
  STORAGE_ACCESS_KEY_ID: 'access',
  STORAGE_SECRET_ACCESS_KEY: 'secret',
};

describe('loadAppConfig', () => {
  it('mặc định cổng 3000, môi trường development', () => {
    assert.deepEqual(loadAppConfig({ DATABASE_URL, JWT_SECRET }), {
      port: 3000,
      nodeEnv: 'development',
      databaseUrl: DATABASE_URL,
      logLevel: 'log',
      jwtSecret: JWT_SECRET,
      trustProxyHops: 0,
      metricsToken: null,
      mail: null,
      storage: null,
      fcm: null,
      ai: null,
    });
  });

  it('TASK-158: METRICS_TOKEN tuỳ chọn, đặt thì phải đủ 32 ký tự', () => {
    const token = 'm'.repeat(32);
    assert.equal(
      loadAppConfig({ DATABASE_URL, JWT_SECRET, METRICS_TOKEN: token }).metricsToken,
      token,
    );
    assert.equal(loadAppConfig({ DATABASE_URL, JWT_SECRET, METRICS_TOKEN: '' }).metricsToken, null);
    assert.throws(
      () => loadAppConfig({ DATABASE_URL, JWT_SECRET, METRICS_TOKEN: 'ngan' }),
      /METRICS_TOKEN phải có ít nhất 32 ký tự/,
    );
  });

  it('TASK-155: đọc TRUST_PROXY_HOPS 0–5, từ chối giá trị khác', () => {
    assert.equal(
      loadAppConfig({ DATABASE_URL, JWT_SECRET, TRUST_PROXY_HOPS: '1' }).trustProxyHops,
      1,
    );
    for (const value of ['-1', '6', 'true', '1.5', '']) {
      assert.throws(
        () => loadAppConfig({ DATABASE_URL, JWT_SECRET, TRUST_PROXY_HOPS: value }),
        /TRUST_PROXY_HOPS không hợp lệ/,
      );
    }
  });

  it('đọc PORT và NODE_ENV hợp lệ', () => {
    const config = loadAppConfig({
      PORT: '8080',
      NODE_ENV: 'production',
      DATABASE_URL,
      JWT_SECRET,
      SMTP_HOST: 'smtp.example.com',
      MAIL_FROM: 'no-reply@example.com',
      ...STORAGE,
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

  it('đọc cấu hình object storage; mặc định region auto, không path-style, link đọc có hạn', () => {
    assert.deepEqual(loadAppConfig({ DATABASE_URL, JWT_SECRET, ...STORAGE }).storage, {
      endpoint: null,
      region: 'auto',
      bucket: 'anh-bds',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      forcePathStyle: false,
      publicUrl: null,
    });
    assert.deepEqual(
      loadAppConfig({
        DATABASE_URL,
        JWT_SECRET,
        ...STORAGE,
        STORAGE_ENDPOINT: 'http://localhost:9000',
        STORAGE_REGION: 'us-east-1',
        STORAGE_FORCE_PATH_STYLE: 'true',
        STORAGE_PUBLIC_URL: 'https://cdn.example.com/',
      }).storage,
      {
        endpoint: 'http://localhost:9000',
        region: 'us-east-1',
        bucket: 'anh-bds',
        accessKeyId: 'access',
        secretAccessKey: 'secret',
        forcePathStyle: true,
        publicUrl: 'https://cdn.example.com',
      },
    );
  });

  it('object storage: bắt buộc ở production, từ chối cấu hình sai', () => {
    const production = {
      DATABASE_URL,
      JWT_SECRET,
      NODE_ENV: 'production',
      SMTP_HOST: 'smtp.example.com',
      MAIL_FROM: 'a@b.vn',
    };
    assert.throws(() => loadAppConfig(production), /Thiếu STORAGE_BUCKET/);
    const base = { DATABASE_URL, JWT_SECRET, ...STORAGE };
    assert.throws(
      () => loadAppConfig({ ...base, STORAGE_SECRET_ACCESS_KEY: '' }),
      /Thiếu STORAGE_ACCESS_KEY_ID hoặc STORAGE_SECRET_ACCESS_KEY/,
    );
    assert.throws(
      () => loadAppConfig({ ...base, STORAGE_ENDPOINT: 'localhost:9000' }),
      /STORAGE_ENDPOINT không hợp lệ/,
    );
    assert.throws(
      () => loadAppConfig({ ...base, STORAGE_PUBLIC_URL: 'ftp://cdn' }),
      /STORAGE_PUBLIC_URL không hợp lệ/,
    );
    assert.throws(
      () => loadAppConfig({ ...base, STORAGE_FORCE_PATH_STYLE: 'yes' }),
      /STORAGE_FORCE_PATH_STYLE không hợp lệ/,
    );
  });

  it('FCM: không bắt buộc, đọc JSON service account base64, từ chối cấu hình sai', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const encode = (value: unknown): string =>
      Buffer.from(JSON.stringify(value)).toString('base64');
    const account = { project_id: 'bds-app', client_email: 'push@bds-app.iam', private_key: pem };

    assert.equal(loadAppConfig({ DATABASE_URL, JWT_SECRET }).fcm, null);
    assert.deepEqual(loadAppConfig({ DATABASE_URL, JWT_SECRET, FCM_CONFIG: encode(account) }).fcm, {
      projectId: 'bds-app',
      clientEmail: 'push@bds-app.iam',
      privateKey: pem,
      tokenUri: 'https://oauth2.googleapis.com/token',
    });
    const withUri = { ...account, token_uri: 'http://localhost:9/token' };
    assert.equal(
      loadAppConfig({ DATABASE_URL, JWT_SECRET, FCM_CONFIG: encode(withUri) }).fcm?.tokenUri,
      'http://localhost:9/token',
    );

    const load = (fcmConfig: string) => () =>
      loadAppConfig({ DATABASE_URL, JWT_SECRET, FCM_CONFIG: fcmConfig });
    assert.throws(load('khong-phai-base64-json'), /FCM_CONFIG không hợp lệ/);
    assert.throws(load(encode({ ...account, client_email: '' })), /FCM_CONFIG thiếu/);
    assert.throws(load(encode(['mảng'])), /FCM_CONFIG thiếu/);
    assert.throws(
      load(encode({ ...account, private_key: 'abc' })),
      /private_key không phải khoá PEM/,
    );
    assert.throws(load(encode({ ...account, token_uri: 'ftp://x' })), /token_uri không hợp lệ/);
  });

  it('AI: không bắt buộc; mặc định Anthropic, giới hạn 100 lượt/24 giờ; từ chối cấu hình sai', () => {
    assert.equal(loadAppConfig({ DATABASE_URL, JWT_SECRET }).ai, null);
    assert.equal(loadAppConfig({ DATABASE_URL, JWT_SECRET, AI_API_KEY: '  ' }).ai, null);
    assert.deepEqual(loadAppConfig({ DATABASE_URL, JWT_SECRET, AI_API_KEY: 'sk-test' }).ai, {
      provider: 'anthropic',
      apiKey: 'sk-test',
      model: 'claude-opus-5-5',
      baseUrl: 'https://api.anthropic.com',
      timeoutMs: 60_000,
      userDailyLimit: 100,
    });
    assert.deepEqual(
      loadAppConfig({
        DATABASE_URL,
        JWT_SECRET,
        AI_API_KEY: 'sk-test',
        AI_PROVIDER: 'anthropic',
        AI_MODEL: 'claude-sonnet-5-5',
        AI_BASE_URL: 'http://localhost:9/',
        AI_TIMEOUT_MS: '5000',
        AI_USER_DAILY_LIMIT: '20',
      }).ai,
      {
        provider: 'anthropic',
        apiKey: 'sk-test',
        model: 'claude-sonnet-5-5',
        baseUrl: 'http://localhost:9',
        timeoutMs: 5000,
        userDailyLimit: 20,
      },
    );

    const load = (extra: Record<string, string>) => () =>
      loadAppConfig({ DATABASE_URL, JWT_SECRET, AI_API_KEY: 'sk-test', ...extra });
    assert.throws(load({ AI_PROVIDER: 'openai' }), /AI_PROVIDER không hợp lệ/);
    assert.throws(load({ AI_BASE_URL: 'ftp://x' }), /AI_BASE_URL không hợp lệ/);
    assert.throws(load({ AI_TIMEOUT_MS: '0' }), /AI_TIMEOUT_MS không hợp lệ/);
    assert.throws(load({ AI_TIMEOUT_MS: '1.5' }), /AI_TIMEOUT_MS không hợp lệ/);
    assert.throws(load({ AI_USER_DAILY_LIMIT: 'abc' }), /AI_USER_DAILY_LIMIT không hợp lệ/);
  });
});
