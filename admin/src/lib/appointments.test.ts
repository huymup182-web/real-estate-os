import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  appointmentApiQuery,
  appointmentFilters,
  appointmentQuery,
  createAppointmentPayload,
  emptyAppointmentForm,
  fromLocalInput,
  toLocalInput,
  updateAppointmentPayload,
  validateAppointmentForm,
  vnDate,
} from './appointments.ts';

const CUSTOMER = '11111111-1111-4111-8111-111111111111';
const PROPERTY = '22222222-2222-4222-8222-222222222222';

describe('giờ Việt Nam', () => {
  it('đổi qua lại giữa ISO và ô datetime-local', () => {
    assert.equal(toLocalInput('2026-10-09T17:30:00.000Z'), '2026-10-10T00:30');
    assert.equal(fromLocalInput('2026-10-10T00:30'), '2026-10-09T17:30:00.000Z');
    assert.equal(fromLocalInput('2026-02-30T09:00'), null);
    assert.equal(fromLocalInput('10/10/2026 09:00'), null);
    assert.equal(vnDate(new Date('2026-10-09T17:30:00Z')), '2026-10-10');
  });
});

describe('bộ lọc lịch hẹn', () => {
  const now = new Date('2026-10-09T18:00:00Z');

  it('mặc định xem từ hôm nay (giờ Việt Nam)', () => {
    const filters = appointmentFilters({}, now);
    assert.deepEqual(filters, { from: '2026-10-10', to: '', status: '', customerId: '', page: 1 });
    assert.equal(appointmentQuery(filters), '?from=2026-10-10');
  });

  it('xoá "Từ ngày" thì xem cả lịch cũ; giá trị sai bị bỏ', () => {
    const filters = appointmentFilters(
      { from: '', to: '2026-13-01', status: 'constructor', customerId: 'x', page: '0' },
      now,
    );
    assert.deepEqual(filters, { from: '', to: '', status: '', customerId: '', page: 1 });
    assert.equal(appointmentQuery(filters, 2), '?from=&page=2');
    assert.equal(appointmentFilters({ from: '2026-10-10', to: '2026-10-01' }, now).to, '');
  });

  it('query backend: đến hết ngày cuối theo giờ Việt Nam', () => {
    const filters = appointmentFilters(
      { from: '2026-10-01', to: '2026-10-31', status: 'SCHEDULED', customerId: CUSTOMER },
      now,
    );
    const query = new URLSearchParams(appointmentApiQuery(filters));
    assert.equal(query.get('from'), '2026-10-01T00:00:00+07:00');
    assert.equal(query.get('to'), '2026-11-01T00:00:00+07:00');
    assert.equal(query.get('status'), 'SCHEDULED');
    assert.equal(query.get('customerId'), CUSTOMER);
    assert.equal(query.get('pageSize'), '20');
  });
});

describe('form lịch hẹn', () => {
  it('báo thiếu khách, BĐS, giờ hẹn và thời lượng sai', () => {
    const errors = validateAppointmentForm({ ...emptyAppointmentForm(), durationMinutes: '0' });
    assert.deepEqual(Object.keys(errors).sort(), [
      'customerId',
      'durationMinutes',
      'propertyId',
      'scheduledAt',
    ]);
    assert.equal(
      'customerId' in validateAppointmentForm({ ...emptyAppointmentForm() }, false),
      false,
    );
  });

  it('body tạo lịch bỏ ô trống', () => {
    const values = {
      ...emptyAppointmentForm(CUSTOMER),
      propertyId: PROPERTY,
      scheduledAt: '2026-10-12T09:00',
      durationMinutes: '',
    };
    assert.deepEqual(validateAppointmentForm(values), {});
    assert.deepEqual(createAppointmentPayload(values), {
      customerId: CUSTOMER,
      propertyId: PROPERTY,
      scheduledAt: '2026-10-12T02:00:00.000Z',
    });
  });

  it('body sửa lịch giữ đúng mốc cũ khi không đổi giờ, ô trống thành null', () => {
    const original = '2026-10-12T02:00:30.000Z';
    const values = {
      ...emptyAppointmentForm(CUSTOMER),
      propertyId: PROPERTY,
      scheduledAt: '2026-10-12T09:00',
      durationMinutes: '45',
    };
    assert.deepEqual(updateAppointmentPayload(values, original), {
      propertyId: PROPERTY,
      scheduledAt: original,
      durationMinutes: 45,
      location: null,
      notes: null,
    });
    assert.equal(
      updateAppointmentPayload({ ...values, scheduledAt: '2026-10-12T10:00' }, original)
        .scheduledAt,
      '2026-10-12T03:00:00.000Z',
    );
  });
});
