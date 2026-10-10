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

interface Group {
  key: string | null;
  name: string | null;
  leads: number;
  contacted: number;
  won: number;
  conversionRate: number | null;
}

interface Conversion {
  scope: string;
  funnel: {
    step: string;
    count: number;
    rateFromLead: number | null;
    rateFromPrevious: number | null;
  }[];
  lost: number;
  medianDaysToContact: number | null;
  medianDaysToWin: number | null;
  bySource: Group[];
  byAgent: Group[];
}

/**
 * Công ty A: admin (COMPANY); phòng D1 có manager (DEPARTMENT), agent1, collab (không có report.view); phòng D2 có
 * agent4. Lead của agent1 dừng ở mỗi bước một người; agent4 có một khách đã chốt (chỉ đổi trạng thái).
 */
describe('/api/v1/reports/conversion (TASK-153)', () => {
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

    const property = await createProperty('agent1', 'HOUSE', vinhHai);
    // Chỉ là lead.
    await createCustomer('agent1', 10);
    // Đã gọi, 2 ngày sau khi tạo.
    const called = await createCustomer('agent1', 10, 'FACEBOOK');
    await insertActivity('agent1', called, 'CALL', daysAgo(8));
    // Đã đi xem (lịch tạo 1 ngày sau).
    const viewed = await createCustomer('agent1', 10);
    await insertAppointment('agent1', viewed, property, daysAgo(9), 'COMPLETED');
    // Đang đàm phán (giao dịch tạo 4 ngày sau).
    const negotiating = await createCustomer('agent1', 10);
    await insertDeal('agent1', negotiating, property, 'NEGOTIATING', daysAgo(6), null);
    // Đã chốt: giao dịch tạo 3 ngày sau, chốt 10 ngày sau khi tạo khách.
    const won = await createCustomer('agent1', 20, 'FACEBOOK');
    await insertDeal('agent1', won, property, 'WON', daysAgo(17), daysAgo(10));
    // Nhập lại: cuộc gọi ghi trước lúc tạo khách, tính là 0 ngày.
    const imported = await createCustomer('agent1', 10);
    await insertActivity('agent1', imported, 'CALL', daysAgo(12));
    // Thất bại, chỉ có ghi chú.
    const lost = await createCustomer('agent1', 5);
    await insertActivity('agent1', lost, 'NOTE', daysAgo(4));
    await db.query(`UPDATE customers SET status = 'LOST' WHERE id = $1`, [lost]);
    // Ngoài kỳ, đã xoá: không tính.
    const old = await createCustomer('agent1', 40);
    await insertDeal('agent1', old, property, 'WON', daysAgo(35), daysAgo(30));
    const deleted = await createCustomer('agent1', 3);
    await db.query(`UPDATE customers SET deleted_at = now() WHERE id = $1`, [deleted]);
    // agent4: chốt nhưng chỉ đổi trạng thái, không có giao dịch.
    const zalo = await createCustomer('agent4', 7, 'ZALO');
    await db.query(`UPDATE customers SET status = 'WON' WHERE id = $1`, [zalo]);

    await createCustomer('adminB', 2);
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

  let phoneSeq = 0;
  async function createCustomer(
    user: string,
    createdDaysAgo: number,
    source?: string,
  ): Promise<string> {
    phoneSeq += 1;
    const response = await request(
      'POST',
      '/customers',
      {
        fullName: `Khách ${phoneSeq}`,
        phone: `+8490123${String(phoneSeq).padStart(4, '0')}`,
        ...(source ? { source } : {}),
      },
      tokens[user],
    );
    assert.equal(response.status, 201, await response.clone().text());
    const id = ((await response.json()) as { data: { id: string } }).data.id;
    await db.query(`UPDATE customers SET created_at = $2 WHERE id = $1`, [
      id,
      daysAgo(createdDaysAgo),
    ]);
    return id;
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

  async function insertAppointment(
    agent: string,
    customerId: string,
    propertyId: string,
    createdAt: Date,
    status: string,
  ): Promise<void> {
    await db.query(
      `INSERT INTO appointments (tenant_id, customer_id, property_id, agent_id, scheduled_at, status,
                                 created_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $5, $4)`,
      [tenantA, customerId, propertyId, userIds[agent], createdAt, status],
    );
  }

  async function insertDeal(
    agent: string,
    customerId: string,
    propertyId: string,
    stage: string,
    createdAt: Date,
    closedAt: Date | null,
  ): Promise<void> {
    await db.query(
      `INSERT INTO deals (tenant_id, customer_id, property_id, agent_id, stage, deal_price, created_at,
                          closed_at, created_by)
       VALUES ($1, $2, $3, $4, $5, 1000000000, $6, $7, $4)`,
      [tenantA, customerId, propertyId, userIds[agent], stage, createdAt, closedAt],
    );
  }

  async function conversion(
    user: string,
    query = '',
  ): Promise<{ status: number; data: Conversion }> {
    const response = await request('GET', `/reports/conversion${query}`, undefined, tokens[user]);
    const body = (await response.json()) as { data: Conversion };
    return { status: response.status, data: body.data };
  }

  it('admin: phễu lead → liên hệ → đi xem → đàm phán → chốt, giảm dần, kèm tỷ lệ', async () => {
    const { status, data } = await conversion('admin');
    assert.equal(status, 200);
    assert.equal(data.scope, 'COMPANY');
    assert.deepEqual(data.funnel, [
      { step: 'LEAD', count: 8, rateFromLead: 100, rateFromPrevious: null },
      { step: 'CONTACTED', count: 7, rateFromLead: 87.5, rateFromPrevious: 87.5 },
      { step: 'VIEWED', count: 4, rateFromLead: 50, rateFromPrevious: 57.1 },
      { step: 'NEGOTIATED', count: 3, rateFromLead: 37.5, rateFromPrevious: 75 },
      { step: 'WON', count: 2, rateFromLead: 25, rateFromPrevious: 66.7 },
    ]);
    assert.equal(data.lost, 1);
    assert.equal(data.medianDaysToContact, 2);
    assert.equal(data.medianDaysToWin, 10);
  });

  it('theo nguồn (đủ mọi nguồn, chưa ghi nguồn ở cuối) và theo người phụ trách', async () => {
    const { data } = await conversion('admin');
    const source = (key: string | null) => data.bySource.find((group) => group.key === key);
    assert.deepEqual(source('FACEBOOK'), {
      key: 'FACEBOOK',
      name: null,
      leads: 2,
      contacted: 2,
      won: 1,
      conversionRate: 50,
    });
    assert.deepEqual(source('ZALO'), {
      key: 'ZALO',
      name: null,
      leads: 1,
      contacted: 1,
      won: 1,
      conversionRate: 100,
    });
    assert.deepEqual(source('TIKTOK'), {
      key: 'TIKTOK',
      name: null,
      leads: 0,
      contacted: 0,
      won: 0,
      conversionRate: null,
    });
    assert.equal(data.bySource.at(-1)?.key, null);
    assert.deepEqual(source(null), {
      key: null,
      name: null,
      leads: 5,
      contacted: 4,
      won: 0,
      conversionRate: 0,
    });
    assert.equal(data.bySource.length, 10);
    assert.deepEqual(data.byAgent, [
      {
        key: userIds['agent1'],
        name: 'agent1',
        leads: 7,
        contacted: 6,
        won: 1,
        conversionRate: 14.3,
      },
      {
        key: userIds['agent4'],
        name: 'agent4',
        leads: 1,
        contacted: 1,
        won: 1,
        conversionRate: 100,
      },
    ]);
  });

  it('theo phạm vi report.view: manager chỉ phòng D1, agent chỉ của mình; không có quyền → 403', async () => {
    const manager = await conversion('manager');
    assert.equal(manager.data.scope, 'DEPARTMENT');
    assert.deepEqual(
      manager.data.funnel.map((step) => step.count),
      [7, 6, 3, 2, 1],
    );
    const agent = await conversion('agent4');
    assert.deepEqual(
      agent.data.funnel.map((step) => step.count),
      [1, 1, 1, 1, 1],
    );
    assert.equal(agent.data.medianDaysToContact, null);
    assert.equal((await conversion('collab')).status, 403);
    assert.equal((await request('GET', '/reports/conversion')).status, 401);
  });

  it('kỳ 60 ngày tính thêm lead cũ; công ty khác chỉ thấy khách của mình; kỳ sai → 400', async () => {
    const longer = await conversion('admin', `?from=${daysAgo(60).toISOString()}`);
    assert.deepEqual(
      longer.data.funnel.map((step) => step.count),
      [9, 8, 5, 4, 3],
    );
    const other = await conversion('adminB');
    assert.deepEqual(
      other.data.funnel.map((step) => step.count),
      [1, 0, 0, 0, 0],
    );
    assert.equal(other.data.funnel[1]?.rateFromPrevious, 0);
    const empty = await conversion(
      'admin',
      `?from=${daysAgo(300).toISOString()}&to=${daysAgo(200).toISOString()}`,
    );
    assert.deepEqual(empty.data.funnel[0], {
      step: 'LEAD',
      count: 0,
      rateFromLead: null,
      rateFromPrevious: null,
    });
    assert.equal(empty.data.funnel[1]?.rateFromPrevious, null);
    assert.equal(
      (
        await conversion(
          'admin',
          `?from=${new Date().toISOString()}&to=${daysAgo(1).toISOString()}`,
        )
      ).status,
      400,
    );
  });
});
