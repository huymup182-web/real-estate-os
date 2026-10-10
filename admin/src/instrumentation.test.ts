import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { accessTokenFromCookie } from './instrumentation.ts';
import { ACCESS_COOKIE } from './lib/auth/session-cookies.ts';

describe('accessTokenFromCookie', () => {
  it('lấy access token trong header cookie', () => {
    assert.equal(accessTokenFromCookie(`a=1; ${ACCESS_COOKIE}=eyJ.x%3D; b=2`), 'eyJ.x=');
    assert.equal(accessTokenFromCookie([`a=1`, `${ACCESS_COOKIE}=tok`]), 'tok');
  });

  it('không có cookie thì undefined', () => {
    assert.equal(accessTokenFromCookie(undefined), undefined);
    assert.equal(accessTokenFromCookie('a=1'), undefined);
  });
});
