import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { notificationFilters, notificationLink, notificationQuery } from './notifications.ts';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

describe('bộ lọc thông báo', () => {
  it('giữ giá trị đúng, bỏ giá trị sai', () => {
    const filters = notificationFilters({ unread: 'true', type: 'VIEWING_REMINDER', page: '2' });
    assert.deepEqual(filters, { unread: true, type: 'VIEWING_REMINDER', page: 2 });
    assert.equal(notificationQuery(filters, 1), '?unread=true&type=VIEWING_REMINDER');
    assert.deepEqual(notificationFilters({ unread: 'yes', type: 'constructor', page: 'x' }), {
      unread: false,
      type: '',
      page: 1,
    });
    assert.equal(notificationQuery(notificationFilters({})), '');
  });
});

describe('link của thông báo', () => {
  it('mở lịch hẹn, BĐS, khách theo data', () => {
    assert.equal(
      notificationLink({ type: 'VIEWING_REMINDER', data: { appointmentId: ID } }),
      `/appointments/${ID}`,
    );
    assert.equal(
      notificationLink({ type: 'MATCHED_PROPERTY', data: { propertyId: ID, matchCount: 2 } }),
      `/properties/${ID}`,
    );
    assert.equal(
      notificationLink({ type: 'CUSTOMER_ASSIGNED', data: { customerId: ID } }),
      `/customers/${ID}`,
    );
  });

  it('nhắc xác minh: một BĐS mở BĐS đó, nhiều BĐS mở danh sách', () => {
    assert.equal(
      notificationLink({ type: 'VERIFY_REQUIRED', data: { propertyIds: [ID] } }),
      `/properties/${ID}`,
    );
    assert.equal(
      notificationLink({ type: 'VERIFY_REQUIRED', data: { propertyIds: [ID, ID2] } }),
      '/properties',
    );
  });

  it('id không phải UUID hoặc không có data thì không có link', () => {
    assert.equal(
      notificationLink({ type: 'NEW_PROPERTY', data: { propertyId: '//evil.example' } }),
      null,
    );
    assert.equal(notificationLink({ type: 'SYSTEM_NOTIFICATION', data: {} }), null);
  });
});
