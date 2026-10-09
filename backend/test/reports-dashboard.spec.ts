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
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

interface Dashboard {
  period: { from: string; to: string };
  scope: string;
  properties: { total: number; new: number; active: number };
  customers: { total: number; new: number };
  viewings: number;
  deals: { new: number; won: number; revenue: number };
  agents: number;
  leadFunnel: { status: string; count: number }[];
  salesFunnel: { stage: string; count: number; value: number }[];
}

/**
 * Công ty A: admin (COMPANY); phòng D1 có manager (DEPARTMENT), leader (TEAM, trưởng team T1 gồm agent1 và
 * collab), agent1 (OWN), agent3 (OWN, ngoài team), collab (không có report.view); phòng D2 có agent4.
 * Công ty B có dữ liệu riêng, không bao giờ được tính cho công ty A.
 */
describe('/api/v1/reports/dashboard', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let tenantA: string;
  let khanhHoa: string;
  let vinhHai: string;
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
      ['leader', 'TEAM_LEADER', d1],
      ['agent1', 'AGENT', d1],
      ['agent3', 'AGENT', d1],
      ['collab', 'COLLABORATOR', d1],
      ['agent4', 'AGENT', d2],
    ] as const) {
      userIds[name] = await insertUser(name, hash, department, role);
    }
    const team = await insertId(
      `INSERT INTO teams (tenant_id, department_id, name, leader_id) VALUES ($1, $2, 'T1', $3)`,
      [tenantA, d1, userIds['leader']],
    );
    for (const name of ['agent1', 'collab']) {
      await db.query(`INSERT INTO team_members (tenant_id, team_id, user_id) VALUES ($1, $2, $3)`, [
        tenantA,
        team,
        userIds[name],
      ]);
    }
    for (const name of Object.keys(userIds)) {
      tokens[name] = await login(`${name}@a.vn`);
    }
    await register('admin@b.vn');
    tokens['adminB'] = await login('admin@b.vn');

    // agent1: một BĐS tạo 60 ngày trước, một BĐS đã bán; 2 khách (1 WON) và 1 khách đã xoá.
    const oldProperty = await createProperty('agent1');
    await db.query(`UPDATE properties SET created_at = $2 WHERE id = $1`, [
      oldProperty,
      daysAgo(60),
    ]);
    const soldProperty = await createProperty('agent1');
    await db.query(`UPDATE properties SET status = 'SOLD' WHERE id = $1`, [soldProperty]);
    const customer1 = await createCustomer('agent1');
    const wonCustomer = await createCustomer('agent1');
    await db.query(`UPDATE customers SET status = 'WON' WHERE id = $1`, [wonCustomer]);
    const deletedCustomer = await createCustomer('agent1');
    await db.query(`UPDATE customers SET deleted_at = now() WHERE id = $1`, [deletedCustomer]);
    await insertAppointment('agent1', customer1, oldProperty, daysAgo(2), 'SCHEDULED');
    await insertAppointment('agent1', customer1, oldProperty, daysAgo(3), 'CANCELLED');
    await insertAppointment('agent1', customer1, oldProperty, daysAgo(40), 'COMPLETED');
    await insertDeal('agent1', wonCustomer, soldProperty, 'WON', 5_000_000_000, daysAgo(1));
    await insertDeal('agent1', customer1, oldProperty, 'NEGOTIATING', 3_000_000_000, null);

    // agent3: giao dịch WON chốt 40 ngày trước (ngoài kỳ mặc định).
    const property3 = await createProperty('agent3');
    const customer3 = await createCustomer('agent3');
    await insertDeal('agent3', customer3, property3, 'WON', 2_000_000_000, daysAgo(40));

    // agent4 (phòng D2): khách đang CONTACTED, một lịch hẹn và một giao dịch WON trong kỳ.
    const property4 = await createProperty('agent4');
    const customer4 = await createCustomer('agent4');
    await db.query(`UPDATE customers SET status = 'CONTACTED' WHERE id = $1`, [customer4]);
    await insertAppointment('agent4', customer4, property4, daysAgo(5), 'SCHEDULED');
    await insertDeal('agent4', customer4, property4, 'WON', 4_000_000_000, daysAgo(10));

    // Công ty B.
    await createProperty('adminB');
    await createCustomer('adminB');
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

  async function insertAppointment(
    agent: string,
    customerId: string,
    propertyId: string,
    scheduledAt: Date,
    status: string,
  ): Promise<void> {
    await db.query(
      `INSERT INTO appointments (tenant_id, customer_id, property_id, agent_id, scheduled_at, status,
                                 created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $4)`,
      [tenantA, customerId, propertyId, userIds[agent], scheduledAt, status],
    );
  }

  async function insertDeal(
    agent: string,
    customerId: string,
    propertyId: string,
    stage: string,
    price: number,
    closedAt: Date | null,
  ): Promise<void> {
    await db.query(
      `INSERT INTO deals (tenant_id, customer_id, property_id, agent_id, stage, deal_price, closed_at,
                          created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $4)`,
      [tenantA, customerId, propertyId, userIds[agent], stage, price, closedAt],
    );
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

  async function createProperty(user: string): Promise<string> {
    const response = await request(
      'POST',
      '/properties',
      {
        title: 'Nhà phố Vĩnh Hải',
        propertyType: 'HOUSE',
        price: 3_500_000_000,
        area: 70,
        provinceId: khanhHoa,
        wardId: vinhHai,
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

  async function dashboard(user: string, query = ''): Promise<Dashboard> {
    const response = await request('GET', `/reports/dashboard${query}`, undefined, tokens[user]);
    assert.equal(response.status, 200, await response.clone().text());
    return ((await response.json()) as { data: Dashboard }).data;
  }

  const funnel = (rows: { count: number }[]): number[] => rows.map((row) => row.count);

  it('COMPANY: số liệu cả công ty trong 30 ngày gần nhất', async () => {
    const data = await dashboard('admin');
    assert.equal(data.scope, 'COMPANY');
    const days = (Date.parse(data.period.to) - Date.parse(data.period.from)) / DAY_MS;
    assert.equal(days, 30);
    assert.deepEqual(data.properties, { total: 4, new: 3, active: 3 });
    assert.deepEqual(data.customers, { total: 4, new: 4 });
    assert.equal(data.viewings, 2);
    assert.deepEqual(data.deals, { new: 4, won: 2, revenue: 9_000_000_000 });
    assert.equal(data.agents, 7);
    assert.deepEqual(data.leadFunnel, [
      { status: 'NEW', count: 2 },
      { status: 'CONTACTED', count: 1 },
      { status: 'QUALIFIED', count: 0 },
      { status: 'VIEWING', count: 0 },
      { status: 'NEGOTIATING', count: 0 },
      { status: 'DEPOSIT', count: 0 },
      { status: 'WON', count: 1 },
      { status: 'LOST', count: 0 },
    ]);
    assert.deepEqual(data.salesFunnel, [
      { stage: 'NEGOTIATING', count: 1, value: 3_000_000_000 },
      { stage: 'DEPOSIT', count: 0, value: 0 },
      { stage: 'CONTRACT', count: 0, value: 0 },
      { stage: 'WON', count: 3, value: 11_000_000_000 },
      { stage: 'LOST', count: 0, value: 0 },
    ]);
  });

  it('kỳ tuỳ chọn chỉ tính bản ghi trong [from, to)', async () => {
    const from = daysAgo(70).toISOString();
    const to = daysAgo(35).toISOString();
    const data = await dashboard('admin', `?from=${from}&to=${to}`);
    assert.equal(data.properties.new, 1);
    assert.equal(data.customers.new, 0);
    assert.equal(data.viewings, 1);
    assert.deepEqual(data.deals, { new: 0, won: 1, revenue: 2_000_000_000 });
    // Số hiện có và phễu không phụ thuộc kỳ.
    assert.equal(data.properties.total, 4);
    assert.equal(data.customers.total, 4);
  });

  it('OWN: chỉ bản ghi mình phụ trách', async () => {
    const data = await dashboard('agent1');
    assert.equal(data.scope, 'OWN');
    assert.deepEqual(data.properties, { total: 2, new: 1, active: 1 });
    assert.deepEqual(data.customers, { total: 2, new: 2 });
    assert.equal(data.viewings, 1);
    assert.deepEqual(data.deals, { new: 2, won: 1, revenue: 5_000_000_000 });
    assert.equal(data.agents, 1);
    assert.deepEqual(funnel(data.leadFunnel), [1, 0, 0, 0, 0, 0, 1, 0]);
    assert.deepEqual(funnel(data.salesFunnel), [1, 0, 0, 1, 0]);
  });

  it('TEAM: trưởng nhóm thấy số liệu của thành viên team', async () => {
    const data = await dashboard('leader');
    assert.equal(data.scope, 'TEAM');
    assert.deepEqual(data.properties, { total: 2, new: 1, active: 1 });
    assert.deepEqual(data.deals, { new: 2, won: 1, revenue: 5_000_000_000 });
    assert.equal(data.agents, 3);
  });

  it('DEPARTMENT: trưởng phòng thấy cả phòng, không thấy phòng khác', async () => {
    const data = await dashboard('manager');
    assert.equal(data.scope, 'DEPARTMENT');
    assert.deepEqual(data.properties, { total: 3, new: 2, active: 2 });
    assert.deepEqual(data.customers, { total: 3, new: 3 });
    assert.equal(data.viewings, 1);
    assert.deepEqual(data.deals, { new: 3, won: 1, revenue: 5_000_000_000 });
    assert.equal(data.agents, 5);
  });

  it('công ty khác chỉ thấy dữ liệu của mình', async () => {
    const data = await dashboard('adminB');
    assert.deepEqual(data.properties, { total: 1, new: 1, active: 1 });
    assert.deepEqual(data.customers, { total: 1, new: 1 });
    assert.equal(data.viewings, 0);
    assert.deepEqual(data.deals, { new: 0, won: 0, revenue: 0 });
    assert.equal(data.agents, 1);
  });

  it('không có report.view → 403; chưa đăng nhập → 401', async () => {
    const forbidden = await request('GET', '/reports/dashboard', undefined, tokens['collab']);
    assert.equal(forbidden.status, 403);
    const anonymous = await request('GET', '/reports/dashboard');
    assert.equal(anonymous.status, 401);
  });

  it('kỳ không hợp lệ → 400', async () => {
    const to = new Date().toISOString();
    for (const query of [
      `?from=${to}&to=${to}`,
      `?from=${daysAgo(400).toISOString()}&to=${to}`,
      '?from=hom-qua',
    ]) {
      const response = await request(
        'GET',
        `/reports/dashboard${query}`,
        undefined,
        tokens['admin'],
      );
      assert.equal(response.status, 400, query);
      const body = (await response.json()) as { error: { code: string } };
      assert.equal(body.error.code, 'VALIDATION_ERROR');
    }
  });
});
