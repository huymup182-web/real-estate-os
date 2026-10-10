import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  emptyPropertyForm,
  formatArea,
  formatPrice,
  getPropertyDuplicates,
  propertyFilters,
  propertyFormValues,
  propertyPayload,
  propertyQuery,
  readPropertyForm,
  validatePropertyForm,
} from './properties.ts';

const PROVINCE = '11111111-1111-4111-8111-111111111111';

describe('bộ lọc danh sách BĐS', () => {
  it('bỏ qua giá trị sai, giữ giá trị đúng và tạo lại query', () => {
    const filters = propertyFilters({
      q: '  nha trang ',
      propertyType: 'HOUSE',
      provinceId: PROVINCE,
      sort: 'price_desc',
      page: '2',
    });
    assert.deepEqual(filters, {
      q: 'nha trang',
      propertyType: 'HOUSE',
      provinceId: PROVINCE,
      sort: 'price_desc',
      page: 2,
    });
    assert.equal(
      propertyQuery(filters, 1),
      `?q=nha+trang&propertyType=HOUSE&provinceId=${PROVINCE}&sort=price_desc`,
    );
    assert.deepEqual(
      propertyFilters({ propertyType: 'CASTLE', provinceId: 'x', sort: 'random', page: '0' }),
      { q: '', propertyType: '', provinceId: '', sort: '', page: 1 },
    );
    assert.equal(propertyQuery(propertyFilters({})), '');
  });
});

describe('định dạng', () => {
  it('giá theo tỷ, triệu; diện tích m²', () => {
    assert.equal(formatPrice(3_500_000_000), '3,5 tỷ');
    assert.equal(formatPrice(850_000_000), '850 triệu');
    assert.equal(formatPrice(500_000), '500.000 đ');
    assert.equal(formatArea(80.5), '80,5 m²');
  });
});

describe('form BĐS', () => {
  function formOf(values: Record<string, string>): FormData {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) {
      data.set(key, value);
    }
    return data;
  }

  it('đọc, kiểm và đổi sang body; ô trống thành null', () => {
    const values = readPropertyForm(
      formOf({
        title: ' Nhà phố Vĩnh Hải ',
        propertyType: 'HOUSE',
        price: '3500000000',
        area: '80,5',
        bedrooms: '3',
        roadWidth: '',
        provinceId: 'p1',
        wardId: 'w1',
        streetAddress: '12 Trần Phú',
      }),
    );
    assert.deepEqual(validatePropertyForm(values), {});
    assert.deepEqual(propertyPayload(values, true), {
      title: 'Nhà phố Vĩnh Hải',
      description: null,
      propertyType: 'HOUSE',
      price: 3_500_000_000,
      area: 80.5,
      bedrooms: 3,
      bathrooms: null,
      floors: null,
      direction: null,
      roadWidth: null,
      legalStatus: null,
      provinceId: 'p1',
      wardId: 'w1',
      streetAddress: '12 Trần Phú',
    });
    // Người không xem được địa chỉ thì không gửi trường này, để không xoá mất.
    assert.ok(!('streetAddress' in propertyPayload(values, false)));
  });

  it('báo lỗi trường bắt buộc và số sai dạng', () => {
    const errors = validatePropertyForm({
      ...emptyPropertyForm(),
      price: '3.500.000',
      area: '0',
      bedrooms: '2.5',
      roadWidth: 'abc',
    });
    assert.deepEqual(Object.keys(errors).sort(), [
      'area',
      'bedrooms',
      'price',
      'propertyType',
      'provinceId',
      'roadWidth',
      'title',
      'wardId',
    ]);
  });

  it('giá trị form từ BĐS đang có', () => {
    const values = propertyFormValues({
      id: 'x',
      code: 'BDS-000001',
      title: 'A',
      description: null,
      propertyType: 'LAND',
      price: 100,
      area: 50.25,
      pricePerM2: 2,
      bedrooms: null,
      bathrooms: 1,
      floors: null,
      direction: 'SE',
      roadWidth: 4.5,
      legalStatus: null,
      provinceId: 'p',
      wardId: 'w',
      streetAddress: null,
      status: 'AVAILABLE',
      agentId: 'a',
      verificationStatus: 'UNVERIFIED',
      lastVerifiedAt: null,
      ownerContactVisible: false,
      createdAt: '',
      updatedAt: '',
    });
    assert.equal(values.area, '50.25');
    assert.equal(values.bedrooms, '');
    assert.equal(values.bathrooms, '1');
    assert.equal(values.roadWidth, '4.5');
    assert.equal(values.streetAddress, '');
  });
});

describe('BĐS nghi trùng (TASK-144)', () => {
  it('GET /properties/:id/duplicates kèm token', async () => {
    const data = {
      threshold: 70,
      matches: [{ code: 'BDS-000125', similarity: 87, reasons: ['Cùng giá'], property: null }],
    };
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ success: true, data }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await getPropertyDuplicates('tok', 'p 1', {
      fetchImpl,
      env: { API_INTERNAL_URL: 'http://backend:3000' },
    });
    assert.deepEqual(result, { ok: true, status: 200, data });
    assert.equal(calls[0]?.url, 'http://backend:3000/api/v1/properties/p%201/duplicates');
    assert.equal((calls[0]?.init.headers as Record<string, string>)['authorization'], 'Bearer tok');
  });
});
