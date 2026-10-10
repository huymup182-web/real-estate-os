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
describe('Thống kê giá thị trường (TASK-145)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let khanhHoa: string;
  let vinhHai: string;
  let locTho: string;
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

  it('không có property.view → 403; chưa đăng nhập → 401', async () => {
    const forbidden = await request('GET', '/reports/market/prices', undefined, tokens['noView']);
    assert.equal(forbidden.status, 403);
    const anonymous = await request('GET', '/reports/market/prices');
    assert.equal(anonymous.status, 401);
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
      const response = await request(
        'GET',
        `/reports/market/prices${query}`,
        undefined,
        tokens['admin'],
      );
      assert.equal(response.status, 400, query);
    }
  });
});
