import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';

import { API_PREFIX, createApp } from '../src/app.factory.js';
import { useTestDatabase } from './support/test-database.js';

describe('Ứng dụng NestJS', () => {
  let app: INestApplication;
  let baseUrl: string;

  before(async () => {
    await useTestDatabase();
    app = await createApp();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await app.close();
  });

  it('khởi động và nhận request HTTP dưới tiền tố /api/v1', async () => {
    assert.equal(API_PREFIX, 'api/v1');
    const response = await fetch(`${baseUrl}/api/v1/khong-ton-tai`);
    assert.equal(response.status, 404);
    const body = (await response.json()) as { statusCode: number };
    assert.equal(body.statusCode, 404);
  });

  it('không có route nào ngoài tiền tố /api/v1', async () => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 404);
  });
});
