import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hasPermission, navItemsFor } from './permissions.ts';

describe('permissions', () => {
  const me = { permissions: [{ code: 'user.view', scope: 'DEPARTMENT' }] };

  it('hasPermission theo mã quyền, không theo phạm vi', () => {
    assert.equal(hasPermission(me, 'user.view'), true);
    assert.equal(hasPermission(me, 'user.manage'), false);
  });

  it('menu ẩn mục không có quyền', () => {
    assert.deepEqual(
      navItemsFor(me).map((item) => item.href),
      ['/', '/notifications', '/users'],
    );
    assert.deepEqual(
      navItemsFor({ permissions: [] }).map((item) => item.href),
      ['/', '/notifications'],
    );
    assert.deepEqual(
      navItemsFor({ permissions: [{ code: 'audit.view', scope: 'OWN' }] }).map((item) => item.href),
      ['/', '/notifications', '/audit-logs'],
    );
    assert.deepEqual(
      navItemsFor({ permissions: [{ code: 'property.view', scope: 'OWN' }] }).map(
        (item) => item.href,
      ),
      ['/', '/notifications', '/properties', '/market'],
    );
  });
});
