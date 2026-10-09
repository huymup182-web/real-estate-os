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
const MISSING = '00000000-0000-4000-8000-000000000000';

interface Deal {
  id: string;
  customer: { id: string; fullName: string };
  property: { id: string; code: string; title: string };
  agentId: string;
  stage: string;
  dealPrice: number | null;
  depositAmount: number | null;
  depositAt: string | null;
  closedAt: string | null;
  notes: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

interface DealPage {
  data: Deal[];
  meta: { page: number; pageSize: number; total: number };
}

interface ApiError {
  error: { code: string; details?: { field?: string }[] };
}

/**
 * Công ty A: admin; phòng D1 có `manager` và team T1 (trưởng nhóm `leader`) gồm agent1, agent2, cộng tác viên
 * `collab` (không có quyền giao dịch); phòng D2 có agent4. Giao dịch mặc định do agent1 tạo, với khách và BĐS
 * của agent1.
 */
describe('/api/v1/deals', () => {
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
      ['agent2', 'AGENT', d1],
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

  function as(user: string, method: string, path: string, payload?: unknown): Promise<Response> {
    return request(method, path, payload, tokens[user]);
  }

  async function createCustomer(user = 'agent1', token = tokens[user]): Promise<string> {
    const response = await request(
      'POST',
      '/customers',
      { fullName: 'Khách được chăm sóc', phone: '+84901234567' },
      token,
    );
    assert.equal(response.status, 201);
    return ((await response.json()) as { data: { id: string } }).data.id;
  }

  async function createProperty(token = tokens['agent1']): Promise<string> {
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
      token,
    );
    assert.equal(response.status, 201);
    return ((await response.json()) as { data: { id: string } }).data.id;
  }

  async function open(payload: Record<string, unknown> = {}, user = 'agent1'): Promise<Deal> {
    const customerId =
      (payload['customerId'] as string | undefined) ?? (await createCustomer(user));
    const propertyId =
      (payload['propertyId'] as string | undefined) ?? (await createProperty(tokens[user]));
    const response = await as(user, 'POST', '/deals', { ...payload, customerId, propertyId });
    assert.equal(response.status, 201, await response.clone().text());
    return ((await response.json()) as { data: Deal }).data;
  }

  async function dataOf(response: Response, status = 200): Promise<Deal> {
    assert.equal(response.status, status, await response.clone().text());
    return ((await response.json()) as { data: Deal }).data;
  }

  async function errorOf(response: Response, status: number): Promise<ApiError['error']> {
    assert.equal(response.status, status, await response.clone().text());
    return ((await response.json()) as ApiError).error;
  }

  function fieldsOf(error: ApiError['error']): string[] {
    return [...new Set(error.details?.map((detail) => detail.field ?? ''))];
  }

  async function auditOf(
    id: string,
    action: string,
  ): Promise<{ user_id: string; changes: unknown }[]> {
    return (await db.query(
      `SELECT user_id, changes FROM audit_logs WHERE entity_type = 'deal' AND entity_id = $1 AND action = $2`,
      [id, action],
    )) as { user_id: string; changes: unknown }[];
  }

  describe('POST', () => {
    it('tạo giao dịch → 201: môi giới là người tạo, NEGOTIATING, kèm tên khách và BĐS; ghi nhật ký', async () => {
      const customerId = await createCustomer();
      const propertyId = await createProperty();
      const deal = await open({
        customerId,
        propertyId,
        dealPrice: 3_400_000_000,
        depositAmount: 100_000_000,
        depositAt: '2026-10-01T03:00:00.000Z',
        notes: '  Khách trả góp  ',
      });
      assert.deepEqual(deal.customer, { id: customerId, fullName: 'Khách được chăm sóc' });
      assert.equal(deal.property.id, propertyId);
      assert.equal(deal.property.title, 'Nhà phố Vĩnh Hải');
      assert.equal(deal.agentId, userIds['agent1']);
      assert.equal(deal.stage, 'NEGOTIATING');
      assert.equal(deal.dealPrice, 3_400_000_000);
      assert.equal(deal.depositAmount, 100_000_000);
      assert.equal(deal.depositAt, '2026-10-01T03:00:00.000Z');
      assert.equal(deal.closedAt, null);
      assert.equal(deal.notes, 'Khách trả góp');
      assert.equal(deal.createdBy, userIds['agent1']);
      assert.equal('tenantId' in deal, false);
      const [audit] = await auditOf(deal.id, 'deal.create');
      assert.equal(audit?.user_id, userIds['agent1']);
    });

    it('dữ liệu sai → 400 kèm trường lỗi', async () => {
      const customerId = await createCustomer();
      const propertyId = await createProperty();
      const valid = { customerId, propertyId };
      for (const [payload, field] of [
        [{ ...valid, customerId: undefined }, 'customerId'],
        [{ ...valid, propertyId: 'abc' }, 'propertyId'],
        [{ ...valid, dealPrice: -1 }, 'dealPrice'],
        [{ ...valid, dealPrice: 1.5 }, 'dealPrice'],
        [{ ...valid, depositAmount: '100' }, 'depositAmount'],
        [{ ...valid, depositAt: 'hôm qua' }, 'depositAt'],
        [{ ...valid, notes: '<b>x</b>' }, 'notes'],
        [{ ...valid, stage: 'WON' }, 'stage'],
        [{ ...valid, agentId: userIds['agent2'] }, 'agentId'],
      ] as const) {
        const error = await errorOf(await as('agent1', 'POST', '/deals', payload), 400);
        assert.deepEqual(fieldsOf(error), [field], JSON.stringify(payload));
      }
    });

    it('khách người tạo không xem được, BĐS không tồn tại → 400 đúng trường; không quyền → 403', async () => {
      const otherCustomer = await createCustomer('agent4');
      const error = await errorOf(
        await as('agent1', 'POST', '/deals', {
          customerId: otherCustomer,
          propertyId: await createProperty(),
        }),
        400,
      );
      assert.deepEqual(fieldsOf(error), ['customerId']);
      const propertyError = await errorOf(
        await as('agent1', 'POST', '/deals', {
          customerId: await createCustomer(),
          propertyId: MISSING,
        }),
        400,
      );
      assert.deepEqual(fieldsOf(propertyError), ['propertyId']);
      await errorOf(
        await as('collab', 'POST', '/deals', { customerId: MISSING, propertyId: MISSING }),
        403,
      );
      await errorOf(await as('collab', 'GET', '/deals'), 403);
    });
  });

  describe('GET', () => {
    it('theo phạm vi: OWN, TEAM, DEPARTMENT, COMPANY; công ty khác không thấy', async () => {
      const deal = await open();
      for (const user of ['agent1', 'leader', 'manager', 'admin']) {
        const found = await dataOf(await as(user, 'GET', `/deals/${deal.id}`));
        assert.equal(found.id, deal.id, user);
      }
      for (const user of ['agent2', 'agent4', 'otherAdmin']) {
        await errorOf(await as(user, 'GET', `/deals/${deal.id}`), 404);
      }
      await errorOf(await as('admin', 'GET', '/deals/abc'), 400);
    });

    it('danh sách mới tạo trước, lọc theo bước, khách, BĐS; phân trang', async () => {
      const customerId = await createCustomer('agent2');
      const first = await open({ customerId, dealPrice: 1_000 }, 'agent2');
      const second = await open({ customerId }, 'agent2');
      await dataOf(await as('agent2', 'POST', `/deals/${first.id}/stage`, { stage: 'WON' }));

      const response = await as('agent2', 'GET', `/deals?customerId=${customerId}`);
      assert.equal(response.status, 200);
      const page = (await response.json()) as DealPage;
      assert.deepEqual(
        page.data.map((deal) => deal.id),
        [second.id, first.id],
      );
      assert.equal(page.meta.total, 2);

      const won = (await (
        await as('agent2', 'GET', `/deals?customerId=${customerId}&stage=WON,LOST`)
      ).json()) as DealPage;
      assert.deepEqual(
        won.data.map((deal) => deal.id),
        [first.id],
      );
      const byProperty = (await (
        await as('agent2', 'GET', `/deals?propertyId=${second.property.id}`)
      ).json()) as DealPage;
      assert.deepEqual(
        byProperty.data.map((deal) => deal.id),
        [second.id],
      );
      const paged = (await (
        await as('agent2', 'GET', `/deals?customerId=${customerId}&pageSize=1&page=2`)
      ).json()) as DealPage;
      assert.deepEqual(
        paged.data.map((deal) => deal.id),
        [first.id],
      );
      await errorOf(await as('agent2', 'GET', '/deals?stage=CLOSED'), 400);
      const mine = (await (await as('agent4', 'GET', '/deals')).json()) as DealPage;
      assert.equal(
        mine.data.some((deal) => deal.agentId !== userIds['agent4']),
        false,
      );
    });
  });

  describe('PATCH', () => {
    it('sửa giá, cọc, ghi chú; null xoá giá trị; ghi nhật ký thay đổi', async () => {
      const deal = await open({ dealPrice: 2_000_000_000, notes: 'Cũ' });
      const updated = await dataOf(
        await as('agent1', 'PATCH', `/deals/${deal.id}`, {
          dealPrice: 2_100_000_000,
          depositAmount: 50_000_000,
          notes: '',
          expectedUpdatedAt: deal.updatedAt,
        }),
      );
      assert.equal(updated.dealPrice, 2_100_000_000);
      assert.equal(updated.depositAmount, 50_000_000);
      assert.equal(updated.notes, null);
      assert.equal(updated.updatedBy, userIds['agent1']);
      const [audit] = await auditOf(deal.id, 'deal.update');
      assert.deepEqual(audit?.changes, {
        dealPrice: [2_000_000_000, 2_100_000_000],
        depositAmount: [null, 50_000_000],
        notes: ['Cũ', null],
      });
      const cleared = await dataOf(
        await as('agent1', 'PATCH', `/deals/${deal.id}`, { dealPrice: null }),
      );
      assert.equal(cleared.dealPrice, null);
    });

    it('bản cũ → 409; không gửi gì → 400; ngoài phạm vi → 404; không đổi khách → 400', async () => {
      const deal = await open();
      await dataOf(await as('agent1', 'PATCH', `/deals/${deal.id}`, { notes: 'Mới' }));
      const conflict = await errorOf(
        await as('agent1', 'PATCH', `/deals/${deal.id}`, {
          notes: 'Ghi đè',
          expectedUpdatedAt: deal.updatedAt,
        }),
        409,
      );
      assert.equal(conflict.code, 'CONFLICT');
      await errorOf(await as('agent1', 'PATCH', `/deals/${deal.id}`, {}), 400);
      await errorOf(await as('agent2', 'PATCH', `/deals/${deal.id}`, { notes: 'x' }), 404);
      await errorOf(await as('agent1', 'PATCH', `/deals/${deal.id}`, { customerId: MISSING }), 400);
    });
  });

  describe('POST /:id/stage', () => {
    it('WON cần giá chốt; vào WON/LOST ghi closedAt, mở lại thì xoá; cùng bước không đổi gì', async () => {
      const deal = await open();
      const noPrice = await errorOf(
        await as('agent1', 'POST', `/deals/${deal.id}/stage`, { stage: 'WON' }),
        422,
      );
      assert.equal(noPrice.code, 'BUSINESS_RULE_VIOLATION');

      const deposit = await dataOf(
        await as('agent1', 'POST', `/deals/${deal.id}/stage`, {
          stage: 'DEPOSIT',
          expectedUpdatedAt: deal.updatedAt,
        }),
      );
      assert.equal(deposit.stage, 'DEPOSIT');
      assert.equal(deposit.closedAt, null);
      const same = await dataOf(
        await as('agent1', 'POST', `/deals/${deal.id}/stage`, { stage: 'DEPOSIT' }),
      );
      assert.equal(same.updatedAt, deposit.updatedAt);

      await dataOf(await as('agent1', 'PATCH', `/deals/${deal.id}`, { dealPrice: 5_000_000_000 }));
      const won = await dataOf(
        await as('agent1', 'POST', `/deals/${deal.id}/stage`, { stage: 'WON' }),
      );
      assert.equal(won.stage, 'WON');
      assert.ok(won.closedAt && Math.abs(Date.parse(won.closedAt) - Date.now()) < 60_000);
      const keepPrice = await errorOf(
        await as('agent1', 'PATCH', `/deals/${deal.id}`, { dealPrice: null }),
        422,
      );
      assert.equal(keepPrice.code, 'BUSINESS_RULE_VIOLATION');

      const reopened = await dataOf(
        await as('agent1', 'POST', `/deals/${deal.id}/stage`, { stage: 'CONTRACT' }),
      );
      assert.equal(reopened.closedAt, null);
      const lost = await dataOf(
        await as('agent1', 'POST', `/deals/${deal.id}/stage`, { stage: 'LOST' }),
      );
      assert.ok(lost.closedAt);
      const audits = await auditOf(deal.id, 'deal.change_stage');
      assert.equal(audits.length, 4);

      await errorOf(
        await as('agent1', 'POST', `/deals/${deal.id}/stage`, {
          stage: 'NEGOTIATING',
          expectedUpdatedAt: deal.updatedAt,
        }),
        409,
      );
      await errorOf(await as('agent1', 'POST', `/deals/${deal.id}/stage`, { stage: 'DONE' }), 400);
      await errorOf(
        await as('agent2', 'POST', `/deals/${deal.id}/stage`, { stage: 'NEGOTIATING' }),
        404,
      );
    });

    it('doanh thu dashboard tính giao dịch WON', async () => {
      const deal = await open({ dealPrice: 777 }, 'agent4');
      const before = await dashboardOf('agent4');
      await dataOf(await as('agent4', 'POST', `/deals/${deal.id}/stage`, { stage: 'WON' }));
      const after = await dashboardOf('agent4');
      assert.equal(after.won, before.won + 1);
      assert.equal(after.revenue, before.revenue + 777);
    });
  });

  async function dashboardOf(user: string): Promise<{ won: number; revenue: number }> {
    const response = await as(user, 'GET', '/reports/dashboard');
    assert.equal(response.status, 200);
    return ((await response.json()) as { data: { deals: { won: number; revenue: number } } }).data
      .deals;
  }

  describe('DELETE', () => {
    it('xoá mềm → 204, không còn xem được; ngoài phạm vi → 404; ghi nhật ký', async () => {
      const deal = await open();
      await errorOf(await as('agent2', 'DELETE', `/deals/${deal.id}`), 404);
      const response = await as('leader', 'DELETE', `/deals/${deal.id}`);
      assert.equal(response.status, 204);
      await errorOf(await as('agent1', 'GET', `/deals/${deal.id}`), 404);
      const [row] = (await db.query(`SELECT deleted_at, updated_by FROM deals WHERE id = $1`, [
        deal.id,
      ])) as { deleted_at: Date | null; updated_by: string }[];
      assert.ok(row?.deleted_at);
      assert.equal(row.updated_by, userIds['leader']);
      assert.equal((await auditOf(deal.id, 'deal.delete')).length, 1);
    });
  });
});
