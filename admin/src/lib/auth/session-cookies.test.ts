import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACCESS_COOKIE,
  clearedSessionCookies,
  REFRESH_COOKIE,
  REFRESH_COOKIE_MAX_AGE,
  sessionCookies,
} from './session-cookies.ts';

const tokens = { accessToken: 'acc', refreshToken: 'ref', expiresIn: 900 };

describe('sessionCookies', () => {
  it('access token hết hạn sớm 30 giây, refresh token 30 ngày, cả hai HttpOnly', () => {
    const [access, refresh] = sessionCookies(tokens, { NODE_ENV: 'development' });
    assert.deepEqual(access, {
      name: ACCESS_COOKIE,
      value: 'acc',
      options: { httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 870 },
    });
    assert.deepEqual(refresh, {
      name: REFRESH_COOKIE,
      value: 'ref',
      options: {
        httpOnly: true,
        secure: false,
        sameSite: 'strict',
        path: '/',
        maxAge: REFRESH_COOKIE_MAX_AGE,
      },
    });
  });

  it('bật Secure ở production', () => {
    for (const cookie of sessionCookies(tokens, { NODE_ENV: 'production' })) {
      assert.equal(cookie.options.secure, true);
    }
  });

  it('cookie xoá phiên rỗng và hết hạn ngay', () => {
    const cleared = clearedSessionCookies({ NODE_ENV: 'production' });
    assert.deepEqual(
      cleared.map((cookie) => [cookie.name, cookie.value, cookie.options.maxAge]),
      [
        [ACCESS_COOKIE, '', 0],
        [REFRESH_COOKIE, '', 0],
      ],
    );
  });
});
