import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  currentUser,
  loginWithBackend,
  logoutWithBackend,
  refreshWithBackend,
} from './auth-api.ts';

const env = { API_INTERNAL_URL: 'http://backend:3000' };
const pair = { accessToken: 'a2', refreshToken: 'r2', expiresIn: 900 };

function recordingFetch(respond: () => Response) {
  const calls: Request[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(new Request(input, init));
    return respond();
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('auth-api', () => {
  it('login gửi identifier + password tới /auth/login', async () => {
    const { calls, fetchImpl } = recordingFetch(() => Response.json({ data: pair }));
    const result = await loginWithBackend({ identifier: 'a@b.vn', password: 'p' }, 'UA', {
      fetchImpl,
      env,
    });
    assert.deepEqual(result, { ok: true, status: 200, data: pair });
    assert.equal(calls[0]?.url, 'http://backend:3000/api/v1/auth/login');
    assert.equal(calls[0]?.method, 'POST');
    assert.deepEqual(await calls[0]?.json(), { identifier: 'a@b.vn', password: 'p' });
  });

  it('refresh song song với cùng token chỉ gọi backend một lần', async () => {
    const { calls, fetchImpl } = recordingFetch(() => Response.json({ data: pair }));
    const results = await Promise.all([
      refreshWithBackend('r-shared', null, { fetchImpl, env }),
      refreshWithBackend('r-shared', null, { fetchImpl, env }),
    ]);
    // Request đến muộn (sau khi lần đầu đã xong) với token cũ vẫn dùng lại kết quả.
    results.push(await refreshWithBackend('r-shared', null, { fetchImpl, env }));

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'http://backend:3000/api/v1/auth/refresh');
    assert.deepEqual(await calls[0]?.json(), { refreshToken: 'r-shared' });
    for (const result of results) {
      assert.deepEqual(result, { ok: true, status: 200, data: pair });
    }

    await refreshWithBackend('r-other', null, { fetchImpl, env });
    assert.equal(calls.length, 2);
  });

  it('logout và me gửi access token', async () => {
    const { calls, fetchImpl } = recordingFetch(() => new Response(null, { status: 204 }));
    await logoutWithBackend('acc', { fetchImpl, env });
    await currentUser('acc', { fetchImpl, env });
    assert.deepEqual(
      calls.map((call) => [call.method, call.url, call.headers.get('authorization')]),
      [
        ['POST', 'http://backend:3000/api/v1/auth/logout', 'Bearer acc'],
        ['GET', 'http://backend:3000/api/v1/auth/me', 'Bearer acc'],
      ],
    );
  });
});
