import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { pointsOf, rankAgents } from '../src/reports/leaderboard.service.js';
import { createApp } from '../src/app.factory.js';
import { hashPassword } from '../src/auth/password.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';
const DAY_MS = 24 * 3600 * 1000;
const BILLION = 1_000_000_000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

interface Agent {
  rank: number;
  userId: string;
  fullName: string;
  points: number;
  listings: number;
  careDays: number;
  viewings: number;
  dealsWon: number;
  revenue: number;
}

describe('Điểm xếp hạng (TASK-151)', () => {
  const agent = (fullName: string, points: number, revenue = 0) => ({
    userId: fullName,
    fullName,
    avatarUrl: null,
    points,
    listings: 0,
    careDays: 0,
    viewings: 0,
    dealsWon: 0,
    revenue,
  });

  it('tin 5, chăm sóc 1, dẫn khách 3, chốt 20', () => {
    assert.equal(pointsOf({ listings: 2, careDays: 3, viewings: 1, dealsWon: 1 }), 36);
    assert.equal(pointsOf({ listings: 0, careDays: 0, viewings: 0, dealsWon: 0 }), 0);
  });

  it('điểm cao trước, bằng điểm cùng hạng và xếp theo doanh số rồi tên', () => {
    const ranked = rankAgents([
      agent('Bình', 10),
      agent('An', 30),
      agent('Cường', 10, 5),
      agent('Dũng', 0),
      agent('Ánh', 0),
    ]);
    assert.deepEqual(
      ranked.map((item) => [item.rank, item.fullName]),
      [
        [1, 'An'],
        [2, 'Cường'],
        [2, 'Bình'],
        [4, 'Ánh'],
        [4, 'Dũng'],
      ],
    );
  });
});

/**
 * Công ty A: admin (COMPANY, không phòng ban); phòng D1 có manager (DEPARTMENT), agent1, agent2 (OWN), collab
 * (không có report.view), agent5 đã nghỉ; phòng D2 có agent4. Công ty B có dữ liệu riêng.
 */
describe('/api/v1/reports/leaderboard (TASK-151)', () => {
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
      ['agent1', 'AGENT', d1],
      ['agent2', 'AGENT', d1],
      ['collab', 'COLLABORATOR', d1],
      ['agent5', 'AGENT', d1],
      ['agent4', 'AGENT', d2],
    ] as const) {
      userIds[name] = await insertUser(name, hash, department, role);
    }
    for (const name of Object.keys(userIds)) {
      tokens[name] = await login(`${name}@a.vn`);
    }
    await register('admin@b.vn');
    tokens['adminB'] = await login('admin@b.vn');

    // agent1: 2 tin trong kỳ (tin cũ 60 ngày, tin đã xoá không tính).
    const property1 = await createProperty('agent1');
    await createProperty('agent1');
    const oldProperty = await createProperty('agent1');
    await db.query(`UPDATE properties SET created_at = $2 WHERE id = $1`, [
      oldProperty,
      daysAgo(60),
    ]);
    const deletedProperty = await createProperty('agent1');
    await db.query(`UPDATE properties SET deleted_at = now() WHERE id = $1`, [deletedProperty]);
    // Chăm sóc: 2 cuộc gọi cùng ngày + 1 ghi chú ngày khác = 2 lượt; đổi trạng thái, hoạt động cũ, khách đã xoá không tính.
    const customer1 = await createCustomer('agent1');
    await insertActivity('agent1', customer1, 'CALL', daysAgo(0));
    await insertActivity('agent1', customer1, 'CALL', daysAgo(0));
    await insertActivity('agent1', customer1, 'NOTE', daysAgo(2));
    await insertActivity('agent1', customer1, 'STATUS_CHANGE', daysAgo(3));
    await insertActivity('agent1', customer1, 'CALL', daysAgo(40));
    const deletedCustomer = await createCustomer('agent1');
    await insertActivity('agent1', deletedCustomer, 'CALL', daysAgo(1));
    await db.query(`UPDATE customers SET deleted_at = now() WHERE id = $1`, [deletedCustomer]);
    await insertAppointment('agent1', customer1, property1, daysAgo(2), 'COMPLETED');
    await insertAppointment('agent1', customer1, property1, daysAgo(1), 'SCHEDULED');
    await insertAppointment('agent1', customer1, property1, daysAgo(40), 'COMPLETED');
    await insertDeal('agent1', customer1, property1, 'WON', 5 * BILLION, daysAgo(1));
    await insertDeal('agent1', customer1, property1, 'NEGOTIATING', 3 * BILLION, null);

    // agent2: 1 tin, 1 giao dịch 6 tỷ = 25 điểm. agent4 (D2): 5 tin = 25 điểm, doanh số 0.
    const property2 = await createProperty('agent2');
    const customer2 = await createCustomer('agent2');
    await insertDeal('agent2', customer2, property2, 'WON', 6 * BILLION, daysAgo(3));
    await insertDeal('agent2', customer2, property2, 'WON', 9 * BILLION, daysAgo(45));
    for (let i = 0; i < 5; i++) {
      await createProperty('agent4');
    }
    // agent5 đã nghỉ: không có trong bảng.
    await createProperty('agent5');
    await db.query(`UPDATE users SET status = 'INACTIVE' WHERE id = $1`, [userIds['agent5']]);

    await createProperty('adminB');
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

  async function insertActivity(
    user: string,
    customerId: string,
    type: string,
    createdAt: Date,
  ): Promise<void> {
    await db.query(
      `INSERT INTO customer_activities (tenant_id, customer_id, user_id, type, occurred_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [tenantA, customerId, userIds[user], type, createdAt],
    );
  }

  async function leaderboard(
    user: string,
    query = '',
  ): Promise<{ status: number; agents: Agent[]; body: Record<string, unknown> }> {
    const response = await request('GET', `/reports/leaderboard${query}`, undefined, tokens[user]);
    const body = (await response.json()) as {
      data?: { agents: Agent[] } & Record<string, unknown>;
    };
    return { status: response.status, agents: body.data?.agents ?? [], body: body.data ?? {} };
  }

  const summary = (agents: Agent[]) =>
    agents.map((agent) => [
      agent.rank,
      agent.fullName,
      agent.points,
      agent.listings,
      agent.careDays,
      agent.viewings,
      agent.dealsWon,
      agent.revenue,
    ]);

  it('admin: cả công ty, điểm theo tin đăng, chăm sóc, dẫn khách, giao dịch chốt trong 30 ngày', async () => {
    const { status, agents, body } = await leaderboard('admin');
    assert.equal(status, 200);
    assert.equal(body['scope'], 'COMPANY');
    assert.deepEqual(body['points'], { listing: 5, care: 1, viewing: 3, dealWon: 20 });
    assert.deepEqual(summary(agents).slice(0, 3), [
      [1, 'agent1', 35, 2, 2, 1, 1, 5 * BILLION],
      [2, 'agent2', 25, 1, 0, 0, 1, 6 * BILLION],
      [2, 'agent4', 25, 5, 0, 0, 0, 0],
    ]);
    assert.deepEqual(
      agents.slice(3).map((agent) => [agent.rank, agent.points]),
      [
        [4, 0],
        [4, 0],
        [4, 0],
      ],
    );
    assert.deepEqual(
      agents.map((agent) => agent.fullName).sort(),
      ['Quản trị', 'agent1', 'agent2', 'agent4', 'collab', 'manager'].sort(),
    );
    assert.equal(agents.find((agent) => agent.fullName === 'agent1')?.userId, userIds['agent1']);
  });

  it('kỳ do người xem chọn: 60 ngày tính thêm tin, hoạt động, lịch, giao dịch cũ', async () => {
    const from = daysAgo(61).toISOString();
    const { agents } = await leaderboard('admin', `?from=${from}`);
    assert.deepEqual(summary(agents).slice(0, 2), [
      [1, 'agent2', 45, 1, 0, 0, 2, 15 * BILLION],
      [2, 'agent1', 44, 3, 3, 2, 1, 5 * BILLION],
    ]);
    const invalid = await request(
      'GET',
      `/reports/leaderboard?from=${new Date().toISOString()}&to=${daysAgo(1).toISOString()}`,
      undefined,
      tokens['admin'],
    );
    assert.equal(invalid.status, 400);
  });

  it('theo phạm vi report.view: manager chỉ phòng D1, agent chỉ mình; không có quyền → 403', async () => {
    const manager = await leaderboard('manager');
    assert.equal(manager.body['scope'], 'DEPARTMENT');
    assert.deepEqual(manager.agents.map((agent) => agent.fullName).sort(), [
      'agent1',
      'agent2',
      'collab',
      'manager',
    ]);
    const agent = await leaderboard('agent1');
    assert.deepEqual(summary(agent.agents), [[1, 'agent1', 35, 2, 2, 1, 1, 5 * BILLION]]);
    assert.equal((await leaderboard('collab')).status, 403);
    const anonymous = await request('GET', '/reports/leaderboard');
    assert.equal(anonymous.status, 401);
  });

  it('công ty khác không thấy dữ liệu công ty A', async () => {
    const { agents } = await leaderboard('adminB');
    assert.deepEqual(summary(agents), [[1, 'Quản trị', 5, 1, 0, 0, 0, 0]]);
  });
});
