import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readLoginForm, validateLoginForm } from './login-form.ts';

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
}

describe('readLoginForm', () => {
  it('cắt khoảng trắng email/SĐT, giữ nguyên mật khẩu, lọc next', () => {
    assert.deepEqual(
      readLoginForm(form({ identifier: '  a@b.vn ', password: ' p ', next: '//evil' })),
      { identifier: 'a@b.vn', password: ' p ', next: '/' },
    );
    assert.deepEqual(readLoginForm(form({ next: '/users' })), {
      identifier: '',
      password: '',
      next: '/users',
    });
  });
});

describe('validateLoginForm', () => {
  const ok = { identifier: 'a@b.vn', password: 'secret', next: '/' };

  it('báo thiếu email/SĐT hoặc mật khẩu', () => {
    assert.equal(validateLoginForm(ok), null);
    assert.equal(
      validateLoginForm({ ...ok, identifier: '' }),
      'Vui lòng nhập email hoặc số điện thoại',
    );
    assert.equal(validateLoginForm({ ...ok, password: '' }), 'Vui lòng nhập mật khẩu');
  });

  it('quá dài thì báo sai thông tin, không gọi backend', () => {
    assert.equal(
      validateLoginForm({ ...ok, password: 'x'.repeat(129) }),
      'Email/số điện thoại hoặc mật khẩu không đúng',
    );
    assert.equal(
      validateLoginForm({ ...ok, identifier: 'x'.repeat(256) }),
      'Email/số điện thoại hoặc mật khẩu không đúng',
    );
  });
});
