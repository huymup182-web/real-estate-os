import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  fieldErrorsFrom,
  filterQuery,
  listUsers,
  readUserForm,
  statusActions,
  userFilters,
  userPayload,
  validateUserForm,
} from './users.ts';

const ROLE = '11111111-1111-4111-8111-111111111111';

describe('userFilters', () => {
  it('giữ giá trị hợp lệ, bỏ giá trị sai', () => {
    assert.deepEqual(
      userFilters({ q: '  an ', status: 'LOCKED', roleId: ROLE, departmentId: 'x', page: '2' }),
      { q: 'an', status: 'LOCKED', roleId: ROLE, departmentId: '', page: 2 },
    );
    assert.deepEqual(userFilters({ status: 'GONE', page: '-1', q: ['a', 'b'] }), {
      q: '',
      status: '',
      roleId: '',
      departmentId: '',
      page: 1,
    });
  });

  it('filterQuery bỏ giá trị rỗng và trang 1', () => {
    const filters = userFilters({ q: 'an', status: 'ACTIVE' });
    assert.equal(filterQuery(filters), '?q=an&status=ACTIVE');
    assert.equal(filterQuery(filters, 3), '?q=an&status=ACTIVE&page=3');
    assert.equal(filterQuery(userFilters({})), '');
  });
});

describe('listUsers', () => {
  it('gửi bộ lọc, trang và pageSize, nhận meta', async () => {
    let url = '';
    const fetchImpl = (async (input: string | URL | Request) => {
      url = String(input);
      return Response.json({
        data: [],
        meta: { page: 2, pageSize: 20, total: 21, totalPages: 2 },
      });
    }) as typeof fetch;
    const result = await listUsers('acc', userFilters({ q: 'an', page: '2' }), {
      fetchImpl,
      env: { API_INTERNAL_URL: 'http://backend:3000' },
    });
    assert.equal(url, 'http://backend:3000/api/v1/users?q=an&page=2&pageSize=20');
    assert.deepEqual(result.ok && result.meta, { page: 2, pageSize: 20, total: 21, totalPages: 2 });
  });
});

describe('form người dùng', () => {
  function form(entries: [string, string][]): FormData {
    const data = new FormData();
    for (const [key, value] of entries) {
      data.append(key, value);
    }
    return data;
  }

  it('đọc form, chuẩn hoá SĐT, ô trống thành null khi gửi', () => {
    const values = readUserForm(
      form([
        ['fullName', ' Lan '],
        ['email', ''],
        ['phone', '+84 901.234-567'],
        ['departmentId', ''],
        ['roleIds', ROLE],
        ['roleIds', 'r2'],
      ]),
    );
    assert.deepEqual(values, {
      fullName: 'Lan',
      email: '',
      phone: '+84901234567',
      departmentId: '',
      roleIds: [ROLE, 'r2'],
    });
    assert.deepEqual(userPayload(values), {
      fullName: 'Lan',
      email: null,
      phone: '+84901234567',
      departmentId: null,
      roleIds: [ROLE, 'r2'],
    });
  });

  it('báo thiếu tên, liên lạc, vai trò', () => {
    assert.deepEqual(
      validateUserForm({ fullName: '', email: '', phone: '', departmentId: '', roleIds: [] }),
      {
        fullName: 'Vui lòng nhập họ tên',
        email: 'Cần email hoặc số điện thoại để đăng nhập',
        roleIds: 'Chọn ít nhất một vai trò',
      },
    );
  });

  it('gom lỗi theo trường từ backend', () => {
    assert.deepEqual(
      fieldErrorsFrom([
        { field: 'email', message: 'Email đã được sử dụng' },
        { field: 'email', message: 'khác' },
        { message: 'không có trường' },
      ]),
      { email: 'Email đã được sử dụng' },
    );
    assert.deepEqual(fieldErrorsFrom(undefined), {});
  });
});

describe('statusActions', () => {
  it('không hiện thao tác về trạng thái đang có', () => {
    assert.deepEqual(
      statusActions('LOCKED').map((action) => action.status),
      ['ACTIVE', 'INACTIVE'],
    );
  });
});
