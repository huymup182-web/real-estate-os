import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { isDatabaseUp } from '../src/health/health.controller.js';
import { useTestDatabase } from './support/test-database.js';

async function startApp(): Promise<{ app: INestApplication; baseUrl: string }> {
  const app = await createApp();
  app.useLogger(false);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe('GET /api/v1/health', () => {
  let app: INestApplication;
  let baseUrl: string;

  before(async () => {
    await useTestDatabase();
    ({ app, baseUrl } = await startApp());
  });

  after(async () => {
    await app.close();
  });

  it('database chạy → 200, status ok, db up, không cần đăng nhập', async () => {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      data: { status: 'ok', db: 'up' },
      message: null,
    });
  });

  it('chỉ có dưới tiền tố /api/v1', async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 404);
  });

  it('database không trả lời → 503, không lộ chi tiết lỗi', async () => {
    const down = await startApp();
    const dataSource = down.app.get(DataSource);
    try {
      await dataSource.destroy();
      const response = await fetch(`${down.baseUrl}/api/v1/health`);
      const raw = await response.text();
      assert.equal(response.status, 503);
      const body = JSON.parse(raw) as { success: boolean; error: { code: string } };
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'INTERNAL_ERROR');
      assert.ok(!/database|postgres|connection/i.test(raw), raw);
    } finally {
      await down.app.close();
    }
  });
});

describe('isDatabaseUp', () => {
  it('true khi database trả lời', async () => {
    assert.equal(await isDatabaseUp({ query: () => Promise.resolve([{ '?column?': 1 }]) }), true);
  });

  it('false khi truy vấn lỗi', async () => {
    assert.equal(await isDatabaseUp({ query: () => Promise.reject(new Error('down')) }), false);
  });

  it('false khi database treo quá thời gian chờ', async () => {
    const startedAt = Date.now();
    assert.equal(await isDatabaseUp({ query: () => new Promise(() => undefined) }, 50), false);
    assert.ok(Date.now() - startedAt < 1000);
  });
});
