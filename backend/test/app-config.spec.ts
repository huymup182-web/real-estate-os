import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadAppConfig } from '../src/config/app-config.js';

const DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/real_estate_os';

describe('loadAppConfig', () => {
  it('mặc định cổng 3000, môi trường development', () => {
    assert.deepEqual(loadAppConfig({ DATABASE_URL }), {
      port: 3000,
      nodeEnv: 'development',
      databaseUrl: DATABASE_URL,
    });
  });

  it('đọc PORT và NODE_ENV hợp lệ', () => {
    const config = loadAppConfig({ PORT: '8080', NODE_ENV: 'production', DATABASE_URL });
    assert.equal(config.port, 8080);
    assert.equal(config.nodeEnv, 'production');
  });

  it('từ chối PORT sai', () => {
    for (const port of ['abc', '0', '65536', '30.5', '-1', '']) {
      assert.throws(() => loadAppConfig({ PORT: port, DATABASE_URL }), /PORT không hợp lệ/, port);
    }
  });

  it('từ chối NODE_ENV lạ', () => {
    assert.throws(
      () => loadAppConfig({ NODE_ENV: 'staging', DATABASE_URL }),
      /NODE_ENV không hợp lệ/,
    );
  });

  it('bắt buộc DATABASE_URL đúng dạng PostgreSQL', () => {
    assert.throws(() => loadAppConfig({}), /Thiếu DATABASE_URL/);
    for (const url of [
      'not-a-url',
      'mysql://u:p@localhost:3306/db',
      'postgresql://u:p@localhost:5432',
    ]) {
      assert.throws(() => loadAppConfig({ DATABASE_URL: url }), /DATABASE_URL không hợp lệ/, url);
    }
    assert.equal(
      loadAppConfig({ DATABASE_URL: 'postgres://u:p@db:5432/x' }).databaseUrl,
      'postgres://u:p@db:5432/x',
    );
  });
});
