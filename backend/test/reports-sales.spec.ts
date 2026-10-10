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
const DAY_MS = 24 * 3600 * 1000;
const BILLION = 1_000_000_000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

interface Sales {
  scope: string;
  summary: {
    wonCount: number;
    revenue: number;
    avgDealValue: number | null;
    lostCount: number;
    winRate: number | null;
    medianDaysToClose: number | null;
  };
  previous: { wonCount: number; revenue: number };
  pipeline: { stage: string; count: number; value: number }[];
  trend: { month: string; wonCount: number; revenue: number }[];
  byPropertyType: { key: string; name: string | null; wonCount: number; revenue: number }[];
  byWard: { key: string; name: string | null; wonCount: number; revenue: number }[];
}

/**
 * Công ty A: admin (COMPANY); phòng D1 có manager (DEPARTMENT), agent1, collab (không có report.view); phòng D2 có
 * agent4. agent1 bán nhà phố ở Vĩnh Hải, agent4 bán căn hộ ở Lộc Thọ. Công ty B có giao dịch riêng.
 */
describe('/api/v1/reports/sales (TASK-152)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let tenantA: string;
  let khanhHoa: string;
  let vinhHai: string;
  let locTho: string;
  const tokens: Record<string, string> = {};
  const userIds: Record<string, string> = {};

  before(async () => {
    await useTestDatabase();
    app = await createApp();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
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
    const admin = await register('admin@a.vn');
    tenantA = admin.tenantId;
    userIds['admin'] = admin.userId;
    const d1 = await insertId(`INSERT INTO departments (tenant_id, name) VALUES ($1, 'D1')`, [
      tenantA,
    ]);
    const d2 = await insertId(`INSERT INTO departments (tenant_id, name) VALUES ($1, 'D2')`, [
      tenantA,
    ]);
    const hash = await hashPassword(PASSWORD);
    for (const [name, role, department] of [
      ['manager', 'MANAGER', d1],
      ['agent1', 'AGENT', d1],
      ['collab', 'COLLABORATOR', d1],
      ['agent4', 'AGENT', d2],
    ] as const) {
      userIds[name] = await insertUser(name, hash, department, role);
    }
    for (const name of Object.keys(userIds)) {
      tokens[name] = await login(`${name}@a.vn`);
    }
    await register('admin@b.vn');
    tokens['adminB'] = await login('admin@b.vn');

    const house = await createProperty('agent1', 'HOUSE', vinhHai);
    const customer1 = await createCustomer('agent1');
    await insertDeal('agent1', customer1, house, 'WON', 5 * BILLION, daysAgo(11), daysAgo(1));
    await insertDeal('agent1', customer1, house, 'WON', 7 * BILLION, daysAgo(25), daysAgo(5));
    await insertDeal('agent1', customer1, house, 'LOST', 6 * BILLION, daysAgo(20), daysAgo(2));
    await insertDeal('agent1', customer1, house, 'NEGOTIATING', 4 * BILLION, daysAgo(3), null);
    await insertDeal('agent1', customer1, house, 'DEPOSIT', 2 * BILLION, daysAgo(3), null);
    const deleted = await insertDeal(
      'agent1',
      customer1,
      house,
      'WON',
      50 * BILLION,
      daysAgo(9),
      daysAgo(4),
    );
    await db.query(`UPDATE deals SET deleted_at = now() WHERE id = $1`, [deleted]);

    const apartment = await createProperty('agent4', 'APARTMENT', locTho);
    const customer4 = await createCustomer('agent4');
    await insertDeal('agent4', customer4, apartment, 'WON', 9 * BILLION, daysAgo(33), daysAgo(3));
    await insertDeal('agent4', customer4, apartment, 'WON', 1 * BILLION, daysAgo(50), daysAgo(40));

    const propertyB = await createProperty('adminB', 'HOUSE', vinhHai);
    const customerB = await createCustomer('adminB');
    await db.query(
      `INSERT INTO deals (tenant_id, customer_id, property_id, agent_id, stage, deal_price, closed_at)
       SELECT tenant_id, $1, $2, agent_id, 'WON', $3, $4 FROM properties WHERE id = $2`,
      [customerB, propertyB, 3 * BILLION, daysAgo(1)],
    );
  });

  after(async () => {
    await app.close();
  });

  async function insertId(sql: string, params: unknown[] = []): Promise<string> {
    const [row] = (await db.query(`${sql} RETURNING id`, params)) as { id: string }[];
    assert.ok(row);
    return row.id;
  }

  async function insertUser(
    name: string,
    hash: string,
    department: string,
    roleCode: string,
  ): Promise<string> {
    const id = await insertId(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, department_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantA, `${name}@a.vn`, hash, name, department],
    );
    await db.query(
      `INSERT INTO user_roles (user_id, role_id, tenant_id)
       SELECT $1, id, tenant_id FROM roles WHERE tenant_id = $2 AND code = $3`,
      [id, tenantA, roleCode],
    );
    return id;
  }

  async function register(email: string): Promise<{ userId: string; tenantId: string }> {
    const response = await request('POST', '/auth/register', {
      companyName: `Công ty ${email}`,
      fullName: 'Quản trị',
      email,
      password: PASSWORD,
    });
    assert.equal(response.status, 201);
    const data = (
      (await response.json()) as { data: { user: { id: string }; company: { id: string } } }
    ).data;
    return { userId: data.user.id, tenantId: data.company.id };
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

  async function createProperty(
    user: string,
    propertyType: string,
    wardId: string,
  ): Promise<string> {
    const response = await request(
      'POST',
      '/properties',
      {
        title: 'BĐS',
        propertyType,
        price: 3_500_000_000,
        area: 70,
        provinceId: khanhHoa,
        wardId,
      },
      tokens[user],
    );
    assert.equal(response.status, 201, await response.clone().text());
    return ((await response.json()) as { data: { id: string } }).data.id;
  }

  async function createCustomer(user: string): Promise<string> {
    const response = await request(
      'POST',
      '/customers',
      { fullName: 'Khách', phone: '+84901234567' },
      tokens[user],
    );
    assert.equal(response.status, 201, await response.clone().text());
    return ((await response.json()) as { data: { id: string } }).data.id;
  }

  async function insertDeal(
    agent: string,
    customerId: string,
    propertyId: string,
    stage: string,
    price: number,
    createdAt: Date,
    closedAt: Date | null,
  ): Promise<string> {
    return insertId(
      `INSERT INTO deals (tenant_id, customer_id, property_id, agent_id, stage, deal_price, created_at,
                          closed_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $4)`,
      [tenantA, customerId, propertyId, userIds[agent], stage, price, createdAt, closedAt],
    );
  }

  async function sales(user: string, query = ''): Promise<{ status: number; data: Sales }> {
    const response = await request('GET', `/reports/sales${query}`, undefined, tokens[user]);
    const body = (await response.json()) as { data: Sales };
    return { status: response.status, data: body.data };
  }

  it('admin: doanh số, tỷ lệ thắng, thời gian chốt, kỳ trước, pipeline trong 30 ngày', async () => {
    const { status, data } = await sales('admin');
    assert.equal(status, 200);
    assert.equal(data.scope, 'COMPANY');
    assert.deepEqual(data.summary, {
      wonCount: 3,
      revenue: 21 * BILLION,
      avgDealValue: 7 * BILLION,
      lostCount: 1,
      winRate: 75,
      medianDaysToClose: 20,
    });
    assert.deepEqual(
      { wonCount: data.previous.wonCount, revenue: data.previous.revenue },
      { wonCount: 1, revenue: 1 * BILLION },
    );
    assert.deepEqual(data.pipeline, [
      { stage: 'NEGOTIATING', count: 1, value: 4 * BILLION },
      { stage: 'DEPOSIT', count: 1, value: 2 * BILLION },
      { stage: 'CONTRACT', count: 0, value: 0 },
    ]);
  });

  it('xu hướng đủ mọi tháng trong kỳ; theo loại BĐS và khu vực, doanh số cao trước', async () => {
    const { data } = await sales('admin');
    assert.ok(data.trend.length >= 2);
    assert.equal(
      data.trend.reduce((total, month) => total + month.wonCount, 0),
      3,
    );
    assert.equal(
      data.trend.reduce((total, month) => total + month.revenue, 0),
      21 * BILLION,
    );
    const months = data.trend.map((month) => month.month);
    assert.deepEqual(months, [...months].sort());
    assert.deepEqual(data.byPropertyType, [
      { key: 'HOUSE', name: null, wonCount: 2, revenue: 12 * BILLION },
      { key: 'APARTMENT', name: null, wonCount: 1, revenue: 9 * BILLION },
    ]);
    assert.deepEqual(data.byWard, [
      { key: vinhHai, name: 'Vĩnh Hải', wonCount: 2, revenue: 12 * BILLION },
      { key: locTho, name: 'Lộc Thọ', wonCount: 1, revenue: 9 * BILLION },
    ]);

    const year = await sales('admin', `?from=${daysAgo(365).toISOString()}`);
    assert.equal(year.data.trend.length, 13);
    assert.equal(year.data.summary.wonCount, 4);
  });

  it('theo phạm vi report.view: manager chỉ phòng D1, agent chỉ của mình; không có quyền → 403', async () => {
    const manager = await sales('manager');
    assert.equal(manager.data.scope, 'DEPARTMENT');
    assert.deepEqual(manager.data.summary, {
      wonCount: 2,
      revenue: 12 * BILLION,
      avgDealValue: 6 * BILLION,
      lostCount: 1,
      winRate: 66.7,
      medianDaysToClose: 15,
    });
    assert.equal(manager.data.previous.wonCount, 0);
    assert.deepEqual(
      manager.data.byWard.map((ward) => ward.name),
      ['Vĩnh Hải'],
    );
    const agent = await sales('agent4');
    assert.equal(agent.data.summary.wonCount, 1);
    assert.equal(agent.data.summary.revenue, 9 * BILLION);
    assert.equal(agent.data.summary.winRate, 100);
    assert.equal((await sales('collab')).status, 403);
    assert.equal((await request('GET', '/reports/sales')).status, 401);
  });

  it('công ty khác chỉ thấy giao dịch của mình; kỳ không hợp lệ → 400', async () => {
    const other = await sales('adminB');
    assert.equal(other.data.summary.wonCount, 1);
    assert.equal(other.data.summary.revenue, 3 * BILLION);
    assert.equal(other.data.summary.lostCount, 0);
    assert.equal(other.data.summary.winRate, 100);
    assert.equal(
      (await sales('admin', `?from=${new Date().toISOString()}&to=${daysAgo(1).toISOString()}`))
        .status,
      400,
    );
    const empty = await sales(
      'admin',
      `?from=${daysAgo(300).toISOString()}&to=${daysAgo(200).toISOString()}`,
    );
    assert.deepEqual(empty.data.summary, {
      wonCount: 0,
      revenue: 0,
      avgDealValue: null,
      lostCount: 0,
      winRate: null,
      medianDaysToClose: null,
    });
  });
});
