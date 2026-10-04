import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadAppConfig } from '../src/config/app-config.js';

describe('loadAppConfig', () => {
  it('mặc định cổng 3000, môi trường development', () => {
    assert.deepEqual(loadAppConfig({}), { port: 3000, nodeEnv: 'development' });
  });

  it('đọc PORT và NODE_ENV hợp lệ', () => {
    assert.deepEqual(loadAppConfig({ PORT: '8080', NODE_ENV: 'production' }), {
      port: 8080,
      nodeEnv: 'production',
    });
  });

  it('từ chối PORT sai', () => {
    for (const port of ['abc', '0', '65536', '30.5', '-1', '']) {
      assert.throws(() => loadAppConfig({ PORT: port }), /PORT không hợp lệ/, port);
    }
  });

  it('từ chối NODE_ENV lạ', () => {
    assert.throws(() => loadAppConfig({ NODE_ENV: 'staging' }), /NODE_ENV không hợp lệ/);
  });
});
