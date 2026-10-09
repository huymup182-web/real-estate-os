import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  actionLabel,
  auditApiQuery,
  auditFilters,
  auditQuery,
  changeRows,
  changeValue,
  entityHref,
  entityLabel,
} from './audit-logs.ts';

const ID = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

describe('bộ lọc nhật ký', () => {
  it('giữ giá trị đúng, bỏ giá trị sai', () => {
    const filters = auditFilters({
      entityType: 'property',
      entityId: ID,
      userId: USER,
      action: 'property.update',
      from: '2026-10-01',
      to: '2026-10-05',
      page: '3',
    });
    assert.deepEqual(filters, {
      entityType: 'property',
      entityId: ID,
      userId: USER,
      action: 'property.update',
      from: '2026-10-01',
      to: '2026-10-05',
      page: 3,
    });
    assert.deepEqual(
      auditFilters({
        entityType: 'constructor',
        entityId: 'x',
        userId: '1',
        action: 'DROP',
        from: '2026-02-30',
        to: 'hôm nay',
        page: '-1',
      }),
      { entityType: '', entityId: '', userId: '', action: '', from: '', to: '', page: 1 },
    );
    assert.equal(auditFilters({ from: '2026-10-05', to: '2026-10-01' }).to, '');
  });

  it('query của trang bỏ ô trống; thay hoặc bỏ một bộ lọc', () => {
    const filters = auditFilters({ entityType: 'deal', userId: USER, page: '2' });
    assert.equal(auditQuery(filters), `?entityType=deal&userId=${USER}&page=2`);
    assert.equal(auditQuery(filters, 1, { userId: '' }), '?entityType=deal');
    assert.equal(auditQuery(auditFilters({})), '');
  });

  it('query gửi backend: ngày theo giờ Việt Nam, đến hết ngày `to`', () => {
    const query = new URLSearchParams(
      auditApiQuery(auditFilters({ action: 'deal.update', from: '2026-10-01', to: '2026-10-31' })),
    );
    assert.equal(query.get('action'), 'deal.update');
    assert.equal(query.get('from'), '2026-10-01T00:00:00+07:00');
    assert.equal(query.get('to'), '2026-11-01T00:00:00+07:00');
    assert.equal(query.get('page'), '1');
    assert.equal(query.get('pageSize'), '30');
    assert.equal(query.has('entityType'), false);
  });
});

describe('hiển thị nhật ký', () => {
  it('tên thao tác và loại đối tượng', () => {
    assert.equal(actionLabel('property.update'), 'Sửa');
    assert.equal(actionLabel('deal.change_stage'), 'Đổi bước');
    assert.equal(actionLabel('property.toString'), 'property.toString');
    assert.equal(entityLabel('customer'), 'Khách hàng');
    assert.equal(entityLabel('invoice'), 'invoice');
    assert.equal(entityLabel(null), '—');
  });

  it('link tới đối tượng chỉ khi id là UUID', () => {
    assert.equal(entityHref('property', ID), `/properties/${ID}`);
    assert.equal(entityHref('department', ID), `/company/departments/${ID}`);
    assert.equal(entityHref('company', null), '/company');
    assert.equal(entityHref('property', '//evil.example'), null);
    assert.equal(entityHref('invoice', ID), null);
    assert.equal(entityHref(null, null), null);
  });

  it('dòng thay đổi [trường, cũ, mới]', () => {
    assert.deepEqual(
      changeRows({ price: [3_000_000_000, 3_200_000_000], notes: [null, 'Gọi lại'], tags: ['a'] }),
      [
        ['price', '3000000000', '3200000000'],
        ['notes', '—', 'Gọi lại'],
        ['tags', '—', '["a"]'],
      ],
    );
    assert.deepEqual(changeRows(null), []);
    assert.equal(changeValue('x'.repeat(10), 5), 'xxxx…');
    assert.equal(changeValue({ a: 1 }), '{"a":1}');
  });
});
