import 'reflect-metadata';

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';

/** Cần PostgreSQL đang chạy và DATABASE_URL (npm test đọc ../.env.development, ../.env). */
describe('Kết nối database', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  before(async () => {
    app = await createApp();
    app.useLogger(false);
    await app.init();
    dataSource = app.get(DataSource);
  });

  after(async () => {
    await app.close();
  });

  it('kết nối PostgreSQL khi khởi động và truy vấn được', async () => {
    assert.equal(dataSource.isInitialized, true);
    const rows: { ok: number }[] = await dataSource.query('SELECT 1 AS ok');
    assert.deepEqual(rows, [{ ok: 1 }]);
  });

  it('không tự đồng bộ schema hay chạy migration', () => {
    assert.equal(dataSource.options.synchronize, false);
    assert.equal(dataSource.options.migrationsRun, false);
  });

  it('đóng kết nối khi tắt ứng dụng', async () => {
    const other = await createApp();
    other.useLogger(false);
    await other.init();
    const otherSource = other.get(DataSource);
    await other.close();
    assert.equal(otherSource.isInitialized, false);
  });
});
