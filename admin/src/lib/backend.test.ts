import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { callBackend, backendUrl, NETWORK_ERROR } from './backend.ts';

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

describe('callBackend', () => {
  const env = { API_INTERNAL_URL: 'http://backend:3000' };

  it('gửi JSON kèm token, trả `data` của body thành công', async () => {
    let request: Request | undefined;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      request = new Request(input, init);
      return Response.json({ success: true, data: { id: 'u1' }, message: null });
    }) as typeof fetch;

    const result = await callBackend(
      '/auth/me',
      { method: 'POST', body: { a: 1 }, accessToken: 'tok', userAgent: 'UA' },
      { fetchImpl, env },
    );

    assert.deepEqual(result, { ok: true, status: 200, data: { id: 'u1' } });
    assert.equal(request?.url, 'http://backend:3000/api/v1/auth/me');
    assert.equal(request?.method, 'POST');
    assert.equal(request?.headers.get('authorization'), 'Bearer tok');
    assert.equal(request?.headers.get('user-agent'), 'UA');
    assert.equal(request?.headers.get('content-type'), 'application/json');
    assert.deepEqual(await request?.json(), { a: 1 });
  });

  it('204 không có body trả data null', async () => {
    const fetchImpl = (async () => new Response(null, { status: 204 })) as typeof fetch;
    assert.deepEqual(await callBackend('/auth/logout', { method: 'POST' }, { fetchImpl, env }), {
      ok: true,
      status: 204,
      data: null,
    });
  });

  it('lỗi trả code và message theo body lỗi chuẩn', async () => {
    const fetchImpl = (async () =>
      Response.json(
        {
          success: false,
          data: null,
          message: 'Sai thông tin',
          error: { code: 'UNAUTHENTICATED', requestId: 'r' },
        },
        { status: 401 },
      )) as typeof fetch;
    assert.deepEqual(await callBackend('/auth/login', {}, { fetchImpl, env }), {
      ok: false,
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'Sai thông tin',
    });
  });

  it('lỗi mạng hoặc body không phải JSON trả status 0', async () => {
    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const html = (async () => new Response('<html>', { status: 502 })) as typeof fetch;
    for (const fetchImpl of [offline, html]) {
      const result = await callBackend('/health', {}, { fetchImpl, env });
      assert.equal(result.ok, false);
      assert.equal(result.status, 0);
      assert.equal(!result.ok && result.code, NETWORK_ERROR);
    }
  });
});
