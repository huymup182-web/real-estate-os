import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { barWidths, fetchDashboard, formatCount, formatVnd, periodDays } from './dashboard.ts';

describe('periodDays', () => {
  it('chỉ nhận 7, 30, 90; còn lại là 30', () => {
    assert.equal(periodDays('7'), 7);
    assert.equal(periodDays('90'), 90);
    for (const raw of [undefined, '', '15', 'abc', ['7', '90']]) {
      assert.equal(periodDays(raw), 30, String(raw));
    }
  });
});

describe('fetchDashboard', () => {
  it('gọi /reports/dashboard với kỳ [now - days, now) và access token', async () => {
    let request: Request | undefined;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      request = new Request(input, init);
      return Response.json({ data: { agents: 3 } });
    }) as typeof fetch;
    const now = new Date('2026-10-09T00:00:00.000Z');

    const result = await fetchDashboard('acc', 7, now, {
      fetchImpl,
      env: { API_INTERNAL_URL: 'http://backend:3000' },
    });

    assert.equal(result.ok, true);
    const url = new URL(request?.url ?? '');
    assert.equal(url.pathname, '/api/v1/reports/dashboard');
    assert.equal(url.searchParams.get('from'), '2026-10-02T00:00:00.000Z');
    assert.equal(url.searchParams.get('to'), '2026-10-09T00:00:00.000Z');
    assert.equal(request?.headers.get('authorization'), 'Bearer acc');
  });
});

describe('định dạng số', () => {
  it('tiền VNĐ dạng ngắn', () => {
    assert.equal(formatVnd(9_000_000_000), '9 tỷ');
    assert.equal(formatVnd(1_250_000_000), '1,25 tỷ');
    assert.equal(formatVnd(850_000_000), '850 triệu');
    assert.equal(formatVnd(0), '0 đ');
  });

  it('số đếm có dấu chấm ngăn cách', () => {
    assert.equal(formatCount(12345), '12.345');
  });
});

describe('barWidths', () => {
  it('theo tỉ lệ bước lớn nhất, tối thiểu 2% khi có giá trị', () => {
    assert.deepEqual(barWidths([10, 5, 0, 0.1]), [100, 50, 0, 2]);
    assert.deepEqual(barWidths([0, 0]), [0, 0]);
    assert.deepEqual(barWidths([]), []);
  });
});
