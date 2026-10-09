import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  customerFilters,
  customerPayload,
  customerQuery,
  normalizePhone,
  preferenceSummary,
  readCustomerForm,
  validateCustomerForm,
} from './customers.ts';

describe('bộ lọc danh sách khách', () => {
  it('giữ giá trị đúng, bỏ giá trị sai', () => {
    const filters = customerFilters({ q: ' An ', status: 'VIEWING', page: '3' });
    assert.deepEqual(filters, { q: 'An', status: 'VIEWING', page: 3 });
    assert.equal(customerQuery(filters, 1), '?q=An&status=VIEWING');
    assert.deepEqual(customerFilters({ status: 'constructor', page: '-1' }), {
      q: '',
      status: '',
      page: 1,
    });
  });
});

describe('form khách hàng', () => {
  it('đổi SĐT sang dạng quốc tế', () => {
    assert.equal(normalizePhone('0901 234 567'), '+84901234567');
    assert.equal(normalizePhone('84.901.234.567'), '+84901234567');
    assert.equal(normalizePhone('+84901234567'), '+84901234567');
    assert.equal(normalizePhone('12'), '12');
  });

  it('đọc, kiểm và đổi sang body; ô trống thành null', () => {
    const data = new FormData();
    data.set('fullName', ' Trần Văn Khách ');
    data.set('phone', '0901234567');
    data.set('email', '');
    data.set('source', 'ZALO');
    const values = readCustomerForm(data);
    assert.deepEqual(validateCustomerForm(values), {});
    assert.deepEqual(customerPayload(values), {
      fullName: 'Trần Văn Khách',
      phone: '+84901234567',
      email: null,
      purpose: null,
      purchaseTimeline: null,
      source: 'ZALO',
      notes: null,
    });
  });

  it('báo lỗi tên trống, SĐT, email sai', () => {
    const errors = validateCustomerForm({
      fullName: '',
      phone: 'abc',
      email: 'a@b',
      purpose: '',
      purchaseTimeline: '',
      source: '',
      notes: '',
    });
    assert.deepEqual(Object.keys(errors).sort(), ['email', 'fullName', 'phone']);
  });
});

describe('tóm tắt nhu cầu', () => {
  const base = {
    id: 'p1',
    transactionType: 'SALE',
    propertyTypes: null,
    budgetMin: null,
    budgetMax: null,
    areaMin: null,
    areaMax: null,
    bedroomsMin: null,
    provinceIds: null,
    isActive: true,
  };

  it('ghép các tiêu chí có giá trị', () => {
    const summary = preferenceSummary(
      {
        ...base,
        propertyTypes: ['APARTMENT', 'LAND_PLOT'],
        budgetMin: 2_000_000_000,
        budgetMax: 3_500_000_000,
        areaMin: 60,
        bedroomsMin: 2,
        provinceIds: ['kh', 'unknown'],
      },
      new Map([['kh', 'Khánh Hoà']]),
    );
    assert.equal(summary, 'Mua · Căn hộ, Đất nền · 2 tỷ – 3,5 tỷ · từ 60 m² · từ 2 PN · Khánh Hoà');
  });

  it('chỉ có loại giao dịch và ngân sách tối đa', () => {
    assert.equal(
      preferenceSummary({ ...base, transactionType: 'RENT', budgetMax: 15_000_000 }, new Map()),
      'Thuê · đến 15 triệu',
    );
  });
});
