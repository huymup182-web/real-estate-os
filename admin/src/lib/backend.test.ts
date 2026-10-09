import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { backendStatus, backendUrl } from './backend.ts';

describe('backendUrl', () => {
  it('ghép API_INTERNAL_URL với /api/v1 và đường dẫn', () => {
    assert.equal(
      backendUrl('/health', { API_INTERNAL_URL: 'http://backend:3000/' }),
      'http://backend:3000/api/v1/health',
    );
    assert.equal(
      backendUrl('properties', { API_INTERNAL_URL: 'https://api.example.vn' }),
      'https://api.example.vn/api/v1/properties',
    );
  });

  it('mặc định là backend chạy local cổng 3000', () => {
    assert.equal(backendUrl('/health', {}), 'http://localhost:3000/api/v1/health');
    assert.equal(
      backendUrl('/health', { API_INTERNAL_URL: '' }),
      'http://localhost:3000/api/v1/health',
    );
  });
});

describe('backendStatus', () => {
  const env = { API_INTERNAL_URL: 'http://backend:3000' };

  it('2xx là up, gọi đúng route health', async () => {
    let calledUrl = '';
    const fakeFetch = (async (input: string | URL | Request) => {
      calledUrl = String(input);
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    assert.equal(await backendStatus(fakeFetch, env), 'up');
    assert.equal(calledUrl, 'http://backend:3000/api/v1/health');
  });

  it('503 hoặc lỗi mạng là down', async () => {
    const unavailable = (async () => new Response('{}', { status: 503 })) as typeof fetch;
    assert.equal(await backendStatus(unavailable, env), 'down');
    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    assert.equal(await backendStatus(offline, env), 'down');
  });
});
