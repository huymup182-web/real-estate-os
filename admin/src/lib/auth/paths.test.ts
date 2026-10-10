import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loginPathFor, safeNextPath } from './paths.ts';

describe('safeNextPath', () => {
  it('giữ đường dẫn nội bộ kèm query', () => {
    assert.equal(safeNextPath('/users?page=2'), '/users?page=2');
  });

  it('chặn đích ra ngoài hoặc không hợp lệ, về trang chủ', () => {
    for (const raw of [
      null,
      undefined,
      '',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'users',
      '/a\nb',
      '/login',
      '/login?next=/x',
    ]) {
      assert.equal(safeNextPath(raw), '/', String(raw));
    }
  });
});

describe('loginPathFor', () => {
  it('kèm next khi không phải trang chủ', () => {
    assert.equal(loginPathFor('/users?page=2'), '/login?next=%2Fusers%3Fpage%3D2');
    assert.equal(loginPathFor('/'), '/login');
  });
});
