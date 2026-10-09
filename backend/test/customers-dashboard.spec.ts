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

interface Customer {
  id: string;
  status: string;
  lostReason: string | null;
  agentId: string | null;
  updatedBy: string | null;
  updatedAt: string;
  [key: string]: unknown;
}

interface ApiError {
  error: { code: string; details?: { field?: string }[] };
}

/**
 * Công ty A: admin; phòng D1 có `manager` (MANAGER), agent3 và team T1 (trưởng nhóm `leader`) gồm agent1,
 * agent2, cộng tác viên `collab`; phòng D2 có agent4; `viewer` (role tuỳ chỉnh: xem khách COMPANY, sửa OWN).
 * Số liệu đếm trên khách của agent4 (một mình ở D2), mỗi test dùng một khoảng thời gian riêng.
 */
describe('/api/v1/customers/dashboard', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let tenantA: string;
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

    const admin = await register('admin@a.vn');
    tenantA = admin.tenantId;
    userIds['admin'] = admin.userId;
    const d1 = await insertId(`INSERT INTO departments (tenant_id, name) VALUES ($1, 'D1')`, [
      tenantA,
    ]);
    const d2 = await insertId(`INSERT INTO departments (tenant_id, name) VALUES ($1, 'D2')`, [
      tenantA,
    ]);
    const viewerRole = await insertId(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'CUSTOMER_VIEWER', 'Xem khách')`,
      [tenantA],
    );
    await db.query(
      `INSERT INTO role_permissions (role_id, permission_id, scope)
       SELECT $1, id, CASE WHEN code = 'customer.view' THEN 'COMPANY' ELSE 'OWN' END
         FROM permissions WHERE code IN ('customer.view', 'customer.edit')`,
      [viewerRole],
    );
    const hash = await hashPassword(PASSWORD);
    for (const [name, role, department] of [
      ['viewer', 'CUSTOMER_VIEWER', d2],
      ['manager', 'MANAGER', d1],
      ['leader', 'TEAM_LEADER', d1],
      ['agent1', 'AGENT', d1],
      ['agent2', 'AGENT', d1],
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
    for (const name of ['agent1', 'agent2', 'collab']) {
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
    tokens['otherAdmin'] = await login('admin@b.vn');
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
    department: string | null,
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

  async function createCustomer(
    token = tokens['agent1'],
    extra: Record<string, unknown> = {},
  ): Promise<Customer> {
    const response = await request(
      'POST',
      '/customers',
      { fullName: 'Khách được giao', phone: '+84901234567', ...extra },
      token,
    );
    assert.equal(response.status, 201);
    return ((await response.json()) as { data: Customer }).data;
  }

  async function changed(id: string, payload: unknown, user = 'agent1'): Promise<Customer> {
    const response = await request('POST', `/customers/${id}/status`, payload, tokens[user]);
    assert.equal(response.status, 200, await response.clone().text());
    return ((await response.json()) as { data: Customer }).data;
  }

  async function errorOf(response: Response, status: number): Promise<ApiError['error']> {
    assert.equal(response.status, status);
    return ((await response.json()) as ApiError).error;
  }

  interface Dashboard {
    period: { from: string; to: string };
    totalCustomers: number;
    newCustomers: number;
    followUpNeeded: number;
    wonCustomers: number;
    lostCustomers: number;
    pipeline: { status: string; count: number }[];
    sources: { source: string | null; count: number }[];
    activities: { type: string; count: number }[];
  }

  async function dashboard(user: string, query = ''): Promise<Dashboard> {
    const response = await request('GET', `/customers/dashboard${query}`, undefined, tokens[user]);
    assert.equal(response.status, 200, await response.clone().text());
    return ((await response.json()) as { data: Dashboard }).data;
  }

  const countOf = <K extends string>(
    rows: ({ count: number } & Record<K, string | null>)[],
    key: K,
    value: string | null,
  ): number | undefined => rows.find((row) => row[key] === value)?.count;

  const daysAgo = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString();

  it('đếm khách của agent4: tổng, mới, chốt/mất, cần chăm sóc, pipeline, nguồn, hoạt động trong kỳ', async () => {
    const won = await createCustomer(tokens['agent4'], { source: 'ZALO' });
    const lost = await createCustomer(tokens['agent4'], { source: 'ZALO' });
    await createCustomer(tokens['agent4']);
    const old = await createCustomer(tokens['agent4']);
    const forgotten = await createCustomer(tokens['agent4']);
    await db.query(
      `UPDATE customers SET created_at = now() - interval '40 days' WHERE id = ANY($1)`,
      [[old.id, forgotten.id]],
    );
    await changed(won.id, { status: 'WON' }, 'agent4');
    await changed(lost.id, { status: 'LOST', lostReason: 'Mua chỗ khác' }, 'agent4');
    const call = await request(
      'POST',
      `/customers/${old.id}/activities`,
      { type: 'CALL', occurredAt: daysAgo(3) },
      tokens['agent4'],
    );
    assert.equal(call.status, 201, await call.clone().text());

    const data = await dashboard('agent4');
    assert.equal(data.totalCustomers, 5);
    assert.equal(data.newCustomers, 3);
    assert.equal(data.wonCustomers, 1);
    assert.equal(data.lostCustomers, 1);
    // `forgotten`: tạo 40 ngày trước, chưa có hoạt động; `old` vừa được gọi; `fresh` mới tạo.
    assert.equal(data.followUpNeeded, 1);
    assert.equal(data.pipeline.length, 8);
    assert.equal(countOf(data.pipeline, 'status', 'NEW'), 3);
    assert.equal(countOf(data.pipeline, 'status', 'WON'), 1);
    assert.equal(countOf(data.pipeline, 'status', 'LOST'), 1);
    assert.equal(countOf(data.pipeline, 'status', 'CONTACTED'), 0);
    assert.equal(countOf(data.sources, 'source', 'ZALO'), 2);
    assert.equal(countOf(data.sources, 'source', null), 3);
    assert.equal(countOf(data.sources, 'source', 'FACEBOOK'), 0);
    assert.equal(data.activities.length, 9);
    assert.equal(countOf(data.activities, 'type', 'STATUS_CHANGE'), 2);
    assert.equal(countOf(data.activities, 'type', 'CALL'), 1);
    assert.equal(countOf(data.activities, 'type', 'NOTE'), 0);
    assert.ok(Math.abs(Date.parse(data.period.to) - Date.now()) < 60_000);
    assert.equal(Date.parse(data.period.to) - Date.parse(data.period.from), 30 * 86_400_000);

    const lastWeek = await dashboard(
      'agent4',
      `?from=${encodeURIComponent(daysAgo(10))}&to=${encodeURIComponent(daysAgo(2))}`,
    );
    assert.equal(lastWeek.totalCustomers, 5);
    assert.equal(lastWeek.newCustomers, 0);
    assert.equal(lastWeek.wonCustomers, 0);
    assert.equal(countOf(lastWeek.activities, 'type', 'CALL'), 1);
    assert.equal(countOf(lastWeek.activities, 'type', 'STATUS_CHANGE'), 0);
  });

  it('chỉ đếm khách trong phạm vi xem; khách đã xoá và công ty khác không tính', async () => {
    const before = await dashboard('agent2');
    const agent1Customer = await createCustomer();
    const agent1Count = (await dashboard('agent1')).totalCustomers;
    assert.equal((await dashboard('agent2')).totalCustomers, before.totalCustomers);
    assert.ok((await dashboard('leader')).totalCustomers >= agent1Count);
    const agent4Total = (await dashboard('agent4')).totalCustomers;
    const manager = await dashboard('manager');
    const company = await dashboard('admin');
    assert.equal(company.totalCustomers, manager.totalCustomers + agent4Total);
    assert.equal((await dashboard('viewer')).totalCustomers, company.totalCustomers);
    assert.equal((await dashboard('otherAdmin')).totalCustomers, 0);

    const removed = await request(
      'DELETE',
      `/customers/${agent1Customer.id}`,
      undefined,
      tokens['admin'],
    );
    assert.equal(removed.status, 204);
    assert.equal((await dashboard('agent1')).totalCustomers, agent1Count - 1);
  });

  it('kỳ sai → 400 kèm trường lỗi; chưa đăng nhập → 401', async () => {
    for (const [query, field] of [
      ['?from=hom-qua', 'from'],
      ['?to=abc', 'to'],
      [`?from=${encodeURIComponent(daysAgo(1))}&to=${encodeURIComponent(daysAgo(2))}`, 'to'],
      [`?from=${encodeURIComponent(daysAgo(400))}`, 'from'],
    ] as const) {
      const response = await request(
        'GET',
        `/customers/dashboard${query}`,
        undefined,
        tokens['agent1'],
      );
      const error = await errorOf(response, 400);
      assert.ok(
        error.details?.some((detail) => detail.field === field),
        `${query}: ${JSON.stringify(error.details)}`,
      );
    }
    assert.equal((await request('GET', '/customers/dashboard')).status, 401);
  });
});
