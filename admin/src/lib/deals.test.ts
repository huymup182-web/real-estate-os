import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createDealPayload,
  dealFilters,
  dealQuery,
  emptyDealForm,
  formatMoney,
  parseAmount,
  updateDealPayload,
  validateDealForm,
} from './deals.ts';

const CUSTOMER = '11111111-1111-4111-8111-111111111111';
const PROPERTY = '22222222-2222-4222-8222-222222222222';

describe('bộ lọc giao dịch', () => {
  it('giữ giá trị đúng, bỏ giá trị sai', () => {
    const filters = dealFilters({ stage: 'WON', customerId: CUSTOMER, page: '2' });
    assert.deepEqual(filters, { stage: 'WON', customerId: CUSTOMER, page: 2 });
    assert.equal(dealQuery(filters, 1), `?stage=WON&customerId=${CUSTOMER}`);
    assert.deepEqual(dealFilters({ stage: 'toString', customerId: 'x', page: '0' }), {
      stage: '',
      customerId: '',
      page: 1,
    });
  });
});

describe('số tiền', () => {
  it('đọc số có dấu chấm, dấu cách; từ chối số lẻ, chữ, số quá lớn', () => {
    assert.equal(parseAmount('3.500.000.000'), 3_500_000_000);
    assert.equal(parseAmount('3 500 000'), 3_500_000);
    assert.equal(parseAmount('0'), 0);
    assert.equal(parseAmount('3,5'), null);
    assert.equal(parseAmount('-1'), null);
    assert.equal(parseAmount('3 tỷ'), null);
    assert.equal(parseAmount('99999999999999999'), null);
    assert.equal(formatMoney(3_500_000_000), '3.500.000.000 đ');
    assert.equal(formatMoney(null), '—');
  });
});

describe('form giao dịch', () => {
  it('báo thiếu khách, BĐS và số tiền, ngày sai', () => {
    const errors = validateDealForm({
      ...emptyDealForm(),
      dealPrice: '3,5 tỷ',
      depositAt: '2026-02-30',
    });
    assert.deepEqual(Object.keys(errors).sort(), [
      'customerId',
      'dealPrice',
      'depositAt',
      'propertyId',
    ]);
    assert.deepEqual(validateDealForm(emptyDealForm(), false), {});
  });

  it('body tạo bỏ ô trống; ngày cọc là 0 giờ theo giờ Việt Nam', () => {
    const values = {
      ...emptyDealForm(CUSTOMER),
      propertyId: PROPERTY,
      dealPrice: '3.400.000.000',
      depositAt: '2026-10-01',
    };
    assert.deepEqual(validateDealForm(values), {});
    assert.deepEqual(createDealPayload(values), {
      customerId: CUSTOMER,
      propertyId: PROPERTY,
      dealPrice: 3_400_000_000,
      depositAt: '2026-09-30T17:00:00.000Z',
    });
  });

  it('body sửa: ô trống thành null, giữ mốc cọc cũ khi không đổi ngày', () => {
    const original = '2026-10-01T03:15:00.000Z';
    const values = { ...emptyDealForm(CUSTOMER), dealPrice: '100', depositAt: '2026-10-01' };
    assert.deepEqual(updateDealPayload(values, original), {
      dealPrice: 100,
      depositAmount: null,
      depositAt: original,
      notes: null,
    });
    assert.equal(
      updateDealPayload({ ...values, depositAt: '2026-10-02' }, original).depositAt,
      '2026-10-01T17:00:00.000Z',
    );
    assert.equal(updateDealPayload({ ...values, depositAt: '' }, original).depositAt, null);
  });
});
