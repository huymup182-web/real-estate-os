import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { NextRequest } from 'next/server.js';

import { proxy } from './proxy.ts';

const realFetch = globalThis.fetch;
let backendCalls: string[] = [];
let refreshResponse: () => Response;

beforeEach(() => {
  backendCalls = [];
  process.env['API_INTERNAL_URL'] = 'http://backend:3000';
  globalThis.fetch = (async (input: string | URL | Request) => {
    backendCalls.push(String(input instanceof Request ? input.url : input));
    return refreshResponse();
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://admin.local${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

describe('proxy', () => {
  it('chưa đăng nhập → chuyển tới /login kèm next', async () => {
    const response = await proxy(request('/users?page=2'));
    assert.equal(response.status, 307);
    assert.equal(
      response.headers.get('location'),
      'http://admin.local/login?next=%2Fusers%3Fpage%3D2',
    );
    assert.deepEqual(backendCalls, []);
  });

  it('trang đăng nhập và request còn access token được cho qua', async () => {
    for (const response of [
      await proxy(request('/login')),
      await proxy(request('/users', 'reos_access=acc')),
    ]) {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('location'), null);
    }
    assert.deepEqual(backendCalls, []);
  });

  it('hết access token → refresh, đặt cookie mới cho trình duyệt và request', async () => {
    refreshResponse = () =>
      Response.json({ data: { accessToken: 'a-new', refreshToken: 'r-new', expiresIn: 900 } });
    const response = await proxy(request('/', 'reos_refresh=r-proxy-ok'));

    assert.equal(response.status, 200);
    assert.deepEqual(backendCalls, ['http://backend:3000/api/v1/auth/refresh']);
    assert.equal(response.cookies.get('reos_access')?.value, 'a-new');
    assert.equal(response.cookies.get('reos_refresh')?.value, 'r-new');
    assert.equal(response.cookies.get('reos_refresh')?.httpOnly, true);
    // Cookie mới được chuyển tiếp cho trang đang render qua header ghi đè của request.
    assert.match(response.headers.get('x-middleware-request-cookie') ?? '', /reos_access=a-new/);
  });

  it('refresh bị từ chối → xoá cookie, về /login', async () => {
    refreshResponse = () =>
      Response.json(
        { success: false, message: 'Token không hợp lệ', error: { code: 'UNAUTHENTICATED' } },
        { status: 401 },
      );
    const response = await proxy(request('/users', 'reos_refresh=r-proxy-revoked'));

    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), 'http://admin.local/login?next=%2Fusers');
    assert.equal(response.cookies.get('reos_refresh')?.value, '');
    assert.equal(response.cookies.get('reos_access')?.value, '');
  });

  it('backend không trả lời → giữ phiên, không chuyển trang', async () => {
    refreshResponse = () => {
      throw new TypeError('fetch failed');
    };
    const response = await proxy(request('/', 'reos_refresh=r-proxy-down'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('location'), null);
  });
});
