import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { hashPassword } from '../src/auth/password.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';
const BILLION = 1_000_000_000;

interface Stats {
  count: number;
  avgPrice: number | null;
  medianPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  avgArea: number | null;
}

interface MarketPrices {
  period: { from: string; to: string; months: number };
  groupBy: string;
  statuses: string[];
  minSample: number;
  overall: Stats;
  groups: (Stats & { key: string; name: string | null })[];
}

interface PerM2 {
  count: number;
  avgPricePerM2: number | null;
  medianPricePerM2: number | null;
  minPricePerM2: number | null;
  maxPricePerM2: number | null;
}

interface MarketPerM2 {
  period: { from: string; to: string; months: number };
  groupBy: string;
  minSample: number;
  overall: PerM2;
  groups: (PerM2 & { key: string; name: string | null })[];
  trend: (PerM2 & { month: string })[];
}

const NO_PER_M2 = {
  avgPricePerM2: null,
  medianPricePerM2: null,
  minPricePerM2: null,
  maxPricePerM2: null,
};

/** Tháng `YYYY-MM` theo giờ Việt Nam. */
function vnMonth(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
  })
    .format(date)
    .slice(0, 7);
}

interface Liquidity {
  supply: number;
  sold: number;
  sellThroughRate: number | null;
  level: string | null;
  medianDaysToSell: number | null;
  medianDaysListed: number | null;
  viewsPerListing: number | null;
  viewingsPerListing: number | null;
}

interface MarketLiquidity {
  period: { months: number };
  groupBy: string;
  minSample: number;
  thresholds: { high: number; medium: number };
  overall: Liquidity;
  groups: (Liquidity & { key: string; name: string | null })[];
}

const NO_PRICES = {
  avgPrice: null,
  medianPrice: null,
  minPrice: null,
  maxPrice: null,
  avgArea: null,
};

/**
 * Công ty A (Khánh Hòa). Vĩnh Hải, nhà phố: 3 tỷ/60 m² (đang bán), 4 tỷ/70 m² (đang giao dịch), 5 tỷ/80 m²
 * (đã bán), 6 tỷ/90 m² (đang bán), 100 tỷ (đã ẩn), 1 tỷ/50 m² đăng 2 năm trước. Lộc Thọ, căn hộ: 2 tỷ, 2,2 tỷ.
 * `own` chỉ xem BĐS mình phụ trách (3, 4, 5 tỷ); `noView` không có `property.view`. Công ty B có căn 50 tỷ ở
 * Vĩnh Hải.
 */
describe('Thống kê giá thị trường (TASK-145), giá/m² (TASK-146)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let khanhHoa: string;
  let vinhHai: string;
  let locTho: string;
  let phuocLong: string;
  const tokens: Record<string, string> = {};

  before(async () => {
    await useTestDatabase();
    app = await createApp();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
    db = app.get(DataSource);

    khanhHoa = await insertId(`INSERT INTO provinces (code, name) VALUES ('56', 'Khánh Hòa')`);
    vinhHai = await insertId(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, '22330', 'Vĩnh Hải')`,
      [khanhHoa],
    );
    locTho = await insertId(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, '22366', 'Lộc Thọ')`,
      [khanhHoa],
    );
    const tenantA = await register('admin@a.vn');
    tokens['admin'] = await login('admin@a.vn');
    const hash = await hashPassword(PASSWORD);
    const ownRole = await role(tenantA, 'OWN_VIEWER', 'property.view', 'OWN');
    const noViewRole = await role(tenantA, 'CUSTOMER_ONLY', 'customer.view', 'COMPANY');
    const users: Record<string, string> = {};
    for (const [name, roleId] of [
      ['own', ownRole],
      ['noView', noViewRole],
    ] as const) {
      users[name] = await insertId(
        `INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, $4)`,
        [tenantA, `${name}@a.vn`, hash, name],
      );
      await db.query(`INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)`, [
        users[name],
        roleId,
        tenantA,
      ]);
      tokens[name] = await login(`${name}@a.vn`);
    }
    await register('admin@b.vn');
    tokens['otherAdmin'] = await login('admin@b.vn');

    const house = (price: number, area: number) => ({
      title: 'Nhà phố Vĩnh Hải',
      propertyType: 'HOUSE',
      price: price * BILLION,
      area,
      provinceId: khanhHoa,
      wardId: vinhHai,
    });
    const owned: string[] = [];
    owned.push(await create('admin', house(3, 60)));
    owned.push(await create('admin', house(4, 70), 'PENDING'));
    owned.push(await create('admin', house(5, 80), 'SOLD'));
    await create('admin', house(6, 90));
    await create('admin', house(100, 100), 'HIDDEN');
    const old = await create('admin', house(1, 50));
    await db.query(`UPDATE properties SET created_at = now() - interval '2 years' WHERE id = $1`, [
      old,
    ]);
    const apartment = (price: number, area: number) => ({
      ...house(price, area),
      title: 'Căn hộ Lộc Thọ',
      propertyType: 'APARTMENT',
      wardId: locTho,
    });
    await create('admin', apartment(2, 50));
    await create('admin', apartment(2.2, 55));
    await db.query(`UPDATE properties SET agent_id = $1 WHERE id = ANY($2::uuid[])`, [
      users['own'],
      owned,
    ]);
    await create('otherAdmin', house(50, 80));

    // Công ty C, Phước Long (thanh khoản). Nhà phố: đã bán sau 30, 70, 90 ngày (theo nhật ký), 200 ngày (BĐS cũ
    // không có nhật ký: lấy lúc sửa), một căn bán từ năm ngoái (ngoài kỳ); 3 căn đang bán đăng 10, 40, 100 ngày
    // trước; một căn đã ẩn. Căn hộ: 3 căn đang bán, chưa bán căn nào.
    phuocLong = await insertId(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, '22384', 'Phước Long')`,
      [khanhHoa],
    );
    const tenantC = await register('admin@c.vn');
    tokens['adminC'] = await login('admin@c.vn');
    const listing = (propertyType: string) => ({
      title: 'Phước Long',
      propertyType,
      price: 3 * BILLION,
      area: 60,
      provinceId: khanhHoa,
      wardId: phuocLong,
    });
    const age = (id: string, days: number) =>
      db.query(
        `UPDATE properties SET created_at = now() - make_interval(days => $2) WHERE id = $1`,
        [id, days],
      );
    const soldAgo = async (id: string, listedDays: number, soldDays: number | null) => {
      await db.query(`UPDATE properties SET status = 'SOLD' WHERE id = $1`, [id]);
      await age(id, listedDays);
      if (soldDays !== null) {
        await db.query(
          `INSERT INTO audit_logs (tenant_id, action, entity_type, entity_id, changes, created_at)
           VALUES ($1, 'property.change_status', 'property', $2, $3, now() - make_interval(days => $4))`,
          [tenantC, id, JSON.stringify({ status: ['AVAILABLE', 'SOLD'] }), soldDays],
        );
      }
    };
    await soldAgo(await create('adminC', listing('HOUSE')), 40, 10);
    await soldAgo(await create('adminC', listing('HOUSE')), 90, 20);
    await soldAgo(await create('adminC', listing('HOUSE')), 120, 30);
    await soldAgo(await create('adminC', listing('HOUSE')), 200, null);
    await soldAgo(await create('adminC', listing('HOUSE')), 500, 400);
    const viewed = await create('adminC', listing('HOUSE'));
    await age(viewed, 10);
    await age(await create('adminC', listing('HOUSE')), 40);
    await age(await create('adminC', listing('HOUSE')), 100);
    await create('adminC', listing('HOUSE'), 'HIDDEN');
    for (let i = 0; i < 3; i++) {
      await create('adminC', listing('APARTMENT'));
    }
    const [adminC] = (await db.query(`SELECT id FROM users WHERE tenant_id = $1`, [tenantC])) as {
      id: string;
    }[];
    assert.ok(adminC);
    for (const days of [1, 2, 3, 800]) {
      await db.query(
        `INSERT INTO property_views (tenant_id, property_id, user_id, viewed_at)
         VALUES ($1, $2, $3, now() - make_interval(days => $4))`,
        [tenantC, viewed, adminC.id, days],
      );
    }
    const customer = await insertId(
      `INSERT INTO customers (tenant_id, full_name, phone) VALUES ($1, 'Khách', '+84900000001')`,
      [tenantC],
    );
    for (const status of ['SCHEDULED', 'CANCELLED']) {
      await db.query(
        `INSERT INTO appointments (tenant_id, customer_id, property_id, agent_id, scheduled_at, status)
         VALUES ($1, $2, $3, $4, now() - interval '1 day', $5)`,
        [tenantC, customer, viewed, adminC.id, status],
      );
    }
  });

  after(async () => {
    await app.close();
  });

  async function insertId(sql: string, params: unknown[] = []): Promise<string> {
    const [row] = (await db.query(`${sql} RETURNING id`, params)) as { id: string }[];
    assert.ok(row);
    return row.id;
  }

  async function role(tenantId: string, code: string, permission: string, scope: string) {
    const id = await insertId(`INSERT INTO roles (tenant_id, code, name) VALUES ($1, $2, $2)`, [
      tenantId,
      code,
    ]);
    await db.query(
      `INSERT INTO role_permissions (role_id, permission_id, scope)
       SELECT $1, id, $3 FROM permissions WHERE code = $2`,
      [id, permission, scope],
    );
    return id;
  }

  async function register(email: string): Promise<string> {
    const response = await request('POST', '/auth/register', {
      companyName: `Công ty ${email}`,
      fullName: 'Quản trị',
      email,
      password: PASSWORD,
    });
    assert.equal(response.status, 201);
    return ((await response.json()) as { data: { company: { id: string } } }).data.company.id;
  }

  async function login(email: string): Promise<string> {
    const response = await request('POST', '/auth/login', {
      identifier: email,
      password: PASSWORD,
    });
    assert.equal(response.status, 200, email);
    return ((await response.json()) as { data: { accessToken: string } }).data.accessToken;
  }

  function request(
    method: string,
    path: string,
    payload?: unknown,
    accessToken?: string,
  ): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  }

  async function create(user: string, payload: unknown, status?: string): Promise<string> {
    const response = await request('POST', '/properties', payload, tokens[user]);
    assert.equal(response.status, 201, await response.clone().text());
    const { data } = (await response.json()) as { data: { id: string } };
    if (status) {
      const changed = await request(
        'POST',
        `/properties/${data.id}/status`,
        { status },
        tokens[user],
      );
      assert.ok(changed.status < 300, await changed.clone().text());
    }
    return data.id;
  }

  async function prices(user: string, query = ''): Promise<MarketPrices> {
    const response = await request(
      'GET',
      `/reports/market/prices${query}`,
      undefined,
      tokens[user],
    );
    assert.equal(response.status, 200, await response.clone().text());
    return ((await response.json()) as { data: MarketPrices }).data;
  }

  it('theo phường: đang bán, đang giao dịch, đã bán trong 12 tháng; giá giữa; nhóm dưới 3 tin ẩn giá', async () => {
    const result = await prices('admin');
    assert.equal(result.groupBy, 'ward');
    assert.deepEqual(result.statuses, ['AVAILABLE', 'PENDING', 'SOLD']);
    assert.equal(result.minSample, 3);
    assert.equal(result.period.months, 12);
    const days = (Date.parse(result.period.to) - Date.parse(result.period.from)) / 86_400_000;
    assert.ok(days >= 365 && days <= 366, String(days));
    assert.deepEqual(result.overall, {
      count: 6,
      avgPrice: Math.round((22.2 * BILLION) / 6),
      medianPrice: 3.5 * BILLION,
      minPrice: 2 * BILLION,
      maxPrice: 6 * BILLION,
      avgArea: 67.5,
    });
    assert.deepEqual(result.groups, [
      {
        key: vinhHai,
        name: 'Vĩnh Hải',
        count: 4,
        avgPrice: 4.5 * BILLION,
        medianPrice: 4.5 * BILLION,
        minPrice: 3 * BILLION,
        maxPrice: 6 * BILLION,
        avgArea: 75,
      },
      { key: locTho, name: 'Lộc Thọ', count: 2, ...NO_PRICES },
    ]);
  });

  it('theo loại BĐS, lọc phường/loại, đổi số tháng', async () => {
    const byType = await prices('admin', '?groupBy=propertyType');
    assert.deepEqual(
      byType.groups.map((group) => [group.key, group.name, group.count]),
      [
        ['HOUSE', null, 4],
        ['APARTMENT', null, 2],
      ],
    );
    const inWard = await prices('admin', `?wardId=${locTho}`);
    assert.deepEqual(inWard.overall, { count: 2, ...NO_PRICES });
    const apartments = await prices('admin', `?provinceId=${khanhHoa}&propertyType=APARTMENT`);
    assert.equal(apartments.overall.count, 2);
    // 36 tháng thì gồm cả căn 1 tỷ đăng 2 năm trước.
    const longer = await prices('admin', `?months=36&wardId=${vinhHai}`);
    assert.equal(longer.period.months, 36);
    assert.equal(longer.overall.count, 5);
    assert.equal(longer.overall.minPrice, 1 * BILLION);
    assert.equal(longer.overall.medianPrice, 4 * BILLION);
  });

  it('chỉ tính BĐS trong phạm vi xem của người hỏi và trong công ty', async () => {
    const own = await prices('own');
    assert.deepEqual(own.groups, [
      {
        key: vinhHai,
        name: 'Vĩnh Hải',
        count: 3,
        avgPrice: 4 * BILLION,
        medianPrice: 4 * BILLION,
        minPrice: 3 * BILLION,
        maxPrice: 5 * BILLION,
        avgArea: 70,
      },
    ]);
    const other = await prices('otherAdmin');
    assert.deepEqual(other.overall, { count: 1, ...NO_PRICES });
    assert.deepEqual(
      other.groups.map((group) => group.count),
      [1],
    );
  });

  async function perM2(user: string, query = ''): Promise<MarketPerM2> {
    const response = await request(
      'GET',
      `/reports/market/price-per-m2${query}`,
      undefined,
      tokens[user],
    );
    assert.equal(response.status, 200, await response.clone().text());
    return ((await response.json()) as { data: MarketPerM2 }).data;
  }

  it('giá/m²: tổng, theo phường, nhóm dưới 3 tin ẩn giá', async () => {
    // Giá/m²: Vĩnh Hải 50 tr, 57.142.857, 62,5 tr, 66.666.667; Lộc Thọ 40 tr, 40 tr.
    const result = await perM2('admin');
    assert.equal(result.groupBy, 'ward');
    assert.equal(result.minSample, 3);
    assert.deepEqual(result.overall, {
      count: 6,
      avgPricePerM2: 52_718_254,
      medianPricePerM2: 53_571_429,
      minPricePerM2: 40_000_000,
      maxPricePerM2: 66_666_667,
    });
    assert.deepEqual(result.groups, [
      {
        key: vinhHai,
        name: 'Vĩnh Hải',
        count: 4,
        avgPricePerM2: 59_077_381,
        medianPricePerM2: 59_821_429,
        minPricePerM2: 50_000_000,
        maxPricePerM2: 66_666_667,
      },
      { key: locTho, name: 'Lộc Thọ', count: 2, ...NO_PER_M2 },
    ]);
    const byType = await perM2('admin', '?groupBy=propertyType');
    assert.deepEqual(
      byType.groups.map((group) => [group.key, group.count, group.medianPricePerM2]),
      [
        ['HOUSE', 4, 59_821_429],
        ['APARTMENT', 2, null],
      ],
    );
  });

  it('giá/m² theo tháng: đủ mọi tháng trong kỳ, tháng không có tin count 0', async () => {
    const result = await perM2('admin');
    assert.equal(result.trend.length, 13);
    const now = vnMonth(new Date());
    assert.equal(result.trend.at(-1)?.month, now);
    assert.deepEqual(result.trend.at(-1), {
      month: now,
      count: 6,
      avgPricePerM2: 52_718_254,
      medianPricePerM2: 53_571_429,
      minPricePerM2: 40_000_000,
      maxPricePerM2: 66_666_667,
    });
    assert.ok(result.trend.slice(0, -1).every((month) => month.count === 0));
    const months = result.trend.map((month) => month.month);
    assert.deepEqual(months, [...months].sort());

    // 36 tháng: thêm căn 1 tỷ/50 m² đăng 2 năm trước, tháng đó 1 tin nên không hiện giá.
    const longer = await perM2('admin', `?months=36&wardId=${vinhHai}`);
    assert.equal(longer.trend.length, 37);
    assert.equal(longer.overall.minPricePerM2, 20_000_000);
    const twoYearsAgo = new Date();
    twoYearsAgo.setUTCFullYear(twoYearsAgo.getUTCFullYear() - 2);
    assert.deepEqual(
      longer.trend.filter((month) => month.count > 0).map((month) => [month.month, month.count]),
      [
        [vnMonth(twoYearsAgo), 1],
        [now, 4],
      ],
    );
  });

  it('giá/m² chỉ tính BĐS trong phạm vi xem và trong công ty', async () => {
    const own = await perM2('own');
    assert.equal(own.overall.count, 3);
    assert.equal(own.overall.medianPricePerM2, 57_142_857);
    const other = await perM2('otherAdmin');
    assert.deepEqual(other.overall, { count: 1, ...NO_PER_M2 });
  });

  async function liquidity(user: string, query = ''): Promise<MarketLiquidity> {
    const response = await request(
      'GET',
      `/reports/market/liquidity${query}`,
      undefined,
      tokens[user],
    );
    assert.equal(response.status, 200, await response.clone().text());
    return ((await response.json()) as { data: MarketLiquidity }).data;
  }

  it('thanh khoản: cung, đã bán trong kỳ, tỷ lệ bán, mức, số ngày bán, lượt xem và dẫn khách', async () => {
    const result = await liquidity('adminC', '?groupBy=propertyType');
    assert.equal(result.minSample, 3);
    assert.deepEqual(result.thresholds, { high: 30, medium: 10 });
    assert.deepEqual(result.groups, [
      {
        key: 'HOUSE',
        name: null,
        supply: 3,
        sold: 4,
        sellThroughRate: 57.1,
        level: 'HIGH',
        // 30, 70, 90, 200 ngày.
        medianDaysToSell: 80,
        medianDaysListed: 40,
        viewsPerListing: 0.4,
        viewingsPerListing: 0.1,
      },
      {
        key: 'APARTMENT',
        name: null,
        supply: 3,
        sold: 0,
        sellThroughRate: 0,
        level: 'LOW',
        medianDaysToSell: null,
        medianDaysListed: 0,
        viewsPerListing: 0,
        viewingsPerListing: 0,
      },
    ]);
    const byWard = await liquidity('adminC');
    assert.deepEqual(
      byWard.groups.map((group) => [group.name, group.supply, group.sold, group.sellThroughRate]),
      [['Phước Long', 6, 4, 40]],
    );
    assert.equal(byWard.overall.level, 'HIGH');
    // 24 tháng: thêm căn bán từ 400 ngày trước (bán sau 100 ngày).
    const longer = await liquidity('adminC', '?months=24&propertyType=HOUSE');
    assert.equal(longer.overall.sold, 5);
    assert.equal(longer.overall.medianDaysToSell, 90);
  });

  it('thanh khoản: dưới 3 tin không xếp mức; chỉ tính BĐS trong phạm vi và công ty', async () => {
    // Công ty A, Vĩnh Hải: đang bán 3, 4, 6 tỷ và căn 1 tỷ đăng 2 năm trước; căn 5 tỷ đã bán.
    const a = await liquidity('admin');
    assert.deepEqual(
      a.groups.map((group) => [
        group.key,
        group.supply,
        group.sold,
        group.sellThroughRate,
        group.level,
      ]),
      [
        [vinhHai, 4, 1, 20, 'MEDIUM'],
        [locTho, 2, 0, null, null],
      ],
    );
    const own = await liquidity('own');
    assert.deepEqual([own.overall.supply, own.overall.sold], [2, 1]);
    const other = await liquidity('otherAdmin');
    assert.deepEqual([other.overall.supply, other.overall.sold, other.overall.level], [1, 0, null]);
  });

  it('không có property.view → 403; chưa đăng nhập → 401', async () => {
    for (const path of [
      '/reports/market/prices',
      '/reports/market/price-per-m2',
      '/reports/market/liquidity',
    ]) {
      const forbidden = await request('GET', path, undefined, tokens['noView']);
      assert.equal(forbidden.status, 403, path);
      const anonymous = await request('GET', path);
      assert.equal(anonymous.status, 401, path);
    }
  });

  it('tham số sai → 400', async () => {
    for (const query of [
      '?months=0',
      '?months=37',
      '?months=abc',
      '?groupBy=district',
      '?propertyType=CASTLE',
      '?wardId=abc',
      '?provinceId=1',
    ]) {
      for (const path of [
        '/reports/market/prices',
        '/reports/market/price-per-m2',
        '/reports/market/liquidity',
      ]) {
        const response = await request('GET', `${path}${query}`, undefined, tokens['admin']);
        assert.equal(response.status, 400, `${path}${query}`);
      }
    }
  });
});
