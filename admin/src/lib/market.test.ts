import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  areaRows,
  fetchMarket,
  formatChange,
  formatMonth,
  type MarketData,
  marketFilters,
  marketQuery,
  trendChange,
} from './market.ts';

const PROVINCE = '11111111-1111-4111-8111-111111111111';

const none = { avgPrice: null, medianPrice: null, minPrice: null, maxPrice: null, avgArea: null };
const perM2None = {
  avgPricePerM2: null,
  medianPricePerM2: null,
  minPricePerM2: null,
  maxPricePerM2: null,
};
const liquidityOf = (supply: number, sold: number) => ({
  supply,
  sold,
  sellThroughRate: null,
  level: null,
  medianDaysToSell: null,
  medianDaysListed: null,
  viewsPerListing: null,
  viewingsPerListing: null,
});

describe('marketFilters', () => {
  it('nhận giá trị hợp lệ, còn lại dùng mặc định', () => {
    assert.deepEqual(
      marketFilters({
        provinceId: PROVINCE,
        propertyType: 'HOUSE',
        groupBy: 'propertyType',
        months: '6',
      }),
      { provinceId: PROVINCE, propertyType: 'HOUSE', groupBy: 'propertyType', months: 6 },
    );
    assert.deepEqual(
      marketFilters({ provinceId: 'abc', propertyType: 'CASTLE', groupBy: 'x', months: '5' }),
      { provinceId: '', propertyType: '', groupBy: 'ward', months: 12 },
    );
  });

  it('query bỏ giá trị mặc định', () => {
    assert.equal(marketQuery(marketFilters({})), '');
    assert.equal(
      marketQuery({ provinceId: PROVINCE, propertyType: 'APARTMENT', groupBy: 'ward', months: 24 }),
      `?provinceId=${PROVINCE}&propertyType=APARTMENT&months=24`,
    );
  });
});

describe('fetchMarket', () => {
  it('gọi ba API cùng bộ lọc; một API lỗi thì trả lỗi đó', async () => {
    const paths: string[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      paths.push(`${url.pathname}${url.search}`);
      assert.equal(request.headers.get('authorization'), 'Bearer acc');
      if (url.pathname.endsWith('/liquidity')) {
        return Response.json({ message: 'Không có quyền' }, { status: 403 });
      }
      return Response.json({ data: {} });
    }) as typeof fetch;
    const result = await fetchMarket(
      'acc',
      { provinceId: '', propertyType: '', groupBy: 'propertyType', months: 12 },
      { fetchImpl, env: { API_INTERNAL_URL: 'http://backend:3000' } },
    );
    assert.deepEqual(paths.sort(), [
      '/api/v1/reports/market/liquidity?groupBy=propertyType',
      '/api/v1/reports/market/price-per-m2?groupBy=propertyType',
      '/api/v1/reports/market/prices?groupBy=propertyType',
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
  });
});

describe('areaRows', () => {
  const data = {
    prices: {
      period: { from: '', to: '', months: 12 },
      minSample: 3,
      overall: { count: 6, ...none },
      groups: [
        { key: 'w1', name: 'Vĩnh Hải', count: 4, ...none, medianPrice: 4_500_000_000 },
        { key: 'w2', name: 'Lộc Thọ', count: 2, ...none },
      ],
    },
    perM2: {
      overall: { count: 6, ...perM2None },
      groups: [{ key: 'w1', name: 'Vĩnh Hải', count: 4, ...perM2None, medianPricePerM2: 6e7 }],
      trend: [],
    },
    liquidity: {
      thresholds: { high: 30, medium: 10 },
      overall: liquidityOf(7, 1),
      groups: [
        { key: 'w3', name: 'Phước Long', ...liquidityOf(5, 0) },
        { key: 'w1', name: 'Vĩnh Hải', ...liquidityOf(4, 1) },
      ],
    },
  } satisfies MarketData;

  it('gộp theo khu vực, nhiều tin tính giá trước, khu chỉ có cung xếp sau', () => {
    const rows = areaRows(data, 'ward');
    assert.deepEqual(
      rows.map((row) => [row.label, row.prices?.count ?? 0, row.liquidity?.supply ?? 0]),
      [
        ['Vĩnh Hải', 4, 4],
        ['Lộc Thọ', 2, 0],
        ['Phước Long', 0, 5],
      ],
    );
    assert.equal(rows[0]?.perM2?.medianPricePerM2, 6e7);
  });

  it('chia theo loại BĐS thì hiện nhãn tiếng Việt', () => {
    const byType = {
      ...data,
      prices: { ...data.prices, groups: [{ key: 'APARTMENT', name: null, count: 3, ...none }] },
      perM2: { ...data.perM2, groups: [] },
      liquidity: { ...data.liquidity, groups: [] },
    };
    assert.deepEqual(
      areaRows(byType, 'propertyType').map((row) => row.label),
      ['Căn hộ'],
    );
  });
});

describe('xu hướng và định dạng', () => {
  const month = (value: string, median: number | null) => ({
    month: value,
    count: median === null ? 0 : 3,
    ...perM2None,
    medianPricePerM2: median,
  });

  it('so tháng đầu với tháng cuối có số liệu', () => {
    assert.equal(
      trendChange([
        month('2026-05', null),
        month('2026-06', 80_000_000),
        month('2026-07', null),
        month('2026-08', 84_960_000),
        month('2026-09', null),
      ]),
      6.2,
    );
    assert.equal(trendChange([month('2026-06', 80_000_000), month('2026-07', null)]), null);
    assert.equal(trendChange([]), null);
  });

  it('định dạng', () => {
    assert.equal(formatChange(6.2), '+6,2%');
    assert.equal(formatChange(-3), '-3%');
    assert.equal(formatChange(0), '0%');
    assert.equal(formatMonth('2026-10'), 'T10/2026');
  });
});
