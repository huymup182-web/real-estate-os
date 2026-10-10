import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyticsMonths, analyticsPeriod, changePercent, fetchSales } from './analytics.ts';

describe('analytics', () => {
  it('analyticsMonths chỉ nhận 3, 6, 12; còn lại là 6', () => {
    assert.equal(analyticsMonths('3'), 3);
    assert.equal(analyticsMonths('12'), 12);
    for (const raw of [undefined, '', '24', 'abc', ['3']]) {
      assert.equal(analyticsMonths(raw), 6, String(raw));
    }
  });

  it('analyticsPeriod lùi đúng số tháng', () => {
    const now = new Date('2026-10-10T05:00:00.000Z');
    assert.deepEqual(analyticsPeriod(3, now), {
      from: new Date('2026-07-10T05:00:00.000Z'),
      to: now,
    });
    assert.equal(analyticsPeriod(12, now).from.toISOString(), '2025-10-10T05:00:00.000Z');
  });

  it('changePercent so với kỳ trước', () => {
    assert.equal(changePercent(15, 10), 50);
    assert.equal(changePercent(5, 10), -50);
    assert.equal(changePercent(1, 3), -66.7);
    assert.equal(changePercent(5, 0), null);
  });

  it('fetchSales gọi /reports/sales với kỳ và access token', async () => {
    let request: Request | undefined;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      request = new Request(input, init);
      return Response.json({ data: {} });
    }) as typeof fetch;
    const result = await fetchSales('acc', 3, new Date('2026-10-10T00:00:00.000Z'), {
      fetchImpl,
      env: { API_INTERNAL_URL: 'http://backend:3000' },
    });
    assert.equal(result.ok, true);
    const url = new URL(request?.url ?? '');
    assert.equal(url.pathname, '/api/v1/reports/sales');
    assert.equal(url.searchParams.get('from'), '2026-07-10T00:00:00.000Z');
    assert.equal(url.searchParams.get('to'), '2026-10-10T00:00:00.000Z');
    assert.equal(request?.headers.get('authorization'), 'Bearer acc');
  });
});
