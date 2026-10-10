import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  companyPayload,
  departmentPayload,
  readCompanyForm,
  readDepartmentForm,
  validateCompanyForm,
  validateDepartmentForm,
} from './company.ts';

describe('form công ty', () => {
  it('đọc, cắt khoảng trắng và đổi số ngày sang số', () => {
    const data = new FormData();
    data.set('name', '  Công ty A ');
    data.set('verifyIntervalDays', ' 14 ');
    const values = readCompanyForm(data);
    assert.deepEqual(values, { name: 'Công ty A', verifyIntervalDays: '14' });
    assert.deepEqual(validateCompanyForm(values), {});
    assert.deepEqual(companyPayload(values), { name: 'Công ty A', verifyIntervalDays: 14 });
  });

  it('báo lỗi tên trống và số ngày ngoài 1–365 hoặc không phải số nguyên', () => {
    for (const days of ['', '0', '366', '1.5', '-3', 'abc']) {
      const errors = validateCompanyForm({ name: '', verifyIntervalDays: days });
      assert.deepEqual(Object.keys(errors).sort(), ['name', 'verifyIntervalDays'], days);
    }
    assert.deepEqual(validateCompanyForm({ name: 'A', verifyIntervalDays: '365' }), {});
  });
});

describe('form phòng ban', () => {
  it('không chọn trưởng phòng thì gửi null', () => {
    const data = new FormData();
    data.set('name', ' Kinh doanh ');
    data.set('managerId', '');
    const values = readDepartmentForm(data);
    assert.deepEqual(validateDepartmentForm(values), {});
    assert.deepEqual(departmentPayload(values), { name: 'Kinh doanh', managerId: null });
    assert.deepEqual(departmentPayload({ name: 'A', managerId: 'u1' }), {
      name: 'A',
      managerId: 'u1',
    });
    assert.deepEqual(Object.keys(validateDepartmentForm({ name: '', managerId: '' })), ['name']);
  });
});
