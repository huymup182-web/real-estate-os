import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  groupByModule,
  readRoleForm,
  roleFormValues,
  rolePayload,
  validateRoleForm,
} from './roles.ts';

describe('groupByModule', () => {
  it('gom theo module, theo thứ tự hiển thị, module lạ xếp cuối', () => {
    const groups = groupByModule([
      { code: 'zeta.view', module: 'zeta', description: 'Z' },
      { code: 'user.view', module: 'user', description: 'Xem' },
      { code: 'property.view', module: 'property', description: 'Xem BĐS' },
      { code: 'property.edit', module: 'property', description: 'Sửa BĐS' },
    ]);
    assert.deepEqual(
      groups.map((group) => [group.label, group.permissions.length]),
      [
        ['Bất động sản', 2],
        ['Người dùng', 1],
        ['zeta', 1],
      ],
    );
  });
});

describe('form vai trò', () => {
  it('đọc mã viết hoa, chỉ lấy quyền có phạm vi hợp lệ', () => {
    const data = new FormData();
    data.set('code', ' sale_lead ');
    data.set('name', ' Trưởng KD ');
    data.set('description', '');
    data.set('perm:property.view', 'COMPANY');
    data.set('perm:customer.view', 'TEAM');
    data.set('perm:user.view', '');
    data.set('perm:deal.view', 'PLATFORM');
    const values = readRoleForm(data);
    assert.deepEqual(values, {
      code: 'SALE_LEAD',
      name: 'Trưởng KD',
      description: '',
      scopes: { 'property.view': 'COMPANY', 'customer.view': 'TEAM' },
    });
    assert.deepEqual(rolePayload(values), {
      name: 'Trưởng KD',
      description: null,
      permissions: [
        { code: 'customer.view', scope: 'TEAM' },
        { code: 'property.view', scope: 'COMPANY' },
      ],
    });
  });

  it('kiểm mã và tên', () => {
    const values = { code: '1AB', name: '', description: '', scopes: {} };
    assert.deepEqual(Object.keys(validateRoleForm(values, true)), ['code', 'name']);
    assert.deepEqual(Object.keys(validateRoleForm(values, false)), ['name']);
  });

  it('giá trị form từ vai trò có sẵn', () => {
    assert.deepEqual(
      roleFormValues({
        id: 'r',
        code: 'AGENT',
        name: 'Môi giới',
        description: null,
        isSystem: true,
        permissionsLocked: false,
        userCount: 0,
        permissionCount: 1,
        permissions: [{ code: 'property.view', scope: 'COMPANY' }],
      }),
      { code: 'AGENT', name: 'Môi giới', description: '', scopes: { 'property.view': 'COMPANY' } },
    );
  });
});
