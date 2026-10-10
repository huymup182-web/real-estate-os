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
 * Mỗi test dùng khách mới do agent1 tạo.
 */
describe('pipeline khách hàng', () => {
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

  async function createCustomer(token = tokens['agent1']): Promise<Customer> {
    const response = await request(
      'POST',
      '/customers',
      { fullName: 'Khách được giao', phone: '+84901234567' },
      token,
    );
    assert.equal(response.status, 201);
    return ((await response.json()) as { data: Customer }).data;
  }

  function changeStatus(id: string, payload: unknown, user = 'agent1'): Promise<Response> {
    return request('POST', `/customers/${id}/status`, payload, tokens[user]);
  }

  async function changed(id: string, payload: unknown, user = 'agent1'): Promise<Customer> {
    const response = await changeStatus(id, payload, user);
    assert.equal(response.status, 200, await response.clone().text());
    return ((await response.json()) as { data: Customer }).data;
  }

  async function errorOf(response: Response, status: number): Promise<ApiError['error']> {
    assert.equal(response.status, status);
    return ((await response.json()) as ApiError).error;
  }

  async function statusActivities(
    id: string,
  ): Promise<{ user_id: string; content: string | null; metadata: unknown }[]> {
    return (await db.query(
      `SELECT user_id, content, metadata FROM customer_activities
        WHERE customer_id = $1 AND type = 'STATUS_CHANGE' ORDER BY created_at, id`,
      [id],
    )) as { user_id: string; content: string | null; metadata: unknown }[];
  }

  describe('POST /customers/:id/status', () => {
    it('đi hết pipeline → 200; mỗi lần đổi ghi timeline và nhật ký', async () => {
      const customer = await createCustomer();
      assert.equal(customer.status, 'NEW');
      for (const status of ['CONTACTED', 'QUALIFIED', 'VIEWING', 'NEGOTIATING', 'DEPOSIT', 'WON']) {
        const current = await changed(customer.id, { status });
        assert.equal(current.status, status);
        assert.equal(current.lostReason, null);
        assert.equal(current.updatedBy, userIds['agent1']);
      }
      const activities = await statusActivities(customer.id);
      assert.equal(activities.length, 6);
      assert.deepEqual(activities[0], {
        user_id: userIds['agent1'],
        content: null,
        metadata: { fromStatus: 'NEW', toStatus: 'CONTACTED' },
      });
      const timeline = (await (
        await request(
          'GET',
          `/customers/${customer.id}/activities?type=STATUS_CHANGE`,
          undefined,
          tokens['agent1'],
        )
      ).json()) as { meta: { total: number } };
      assert.equal(timeline.meta.total, 6);
      const audit = (await db.query(
        `SELECT changes FROM audit_logs WHERE entity_id = $1 AND action = 'customer.change_status'
          ORDER BY created_at DESC, id DESC LIMIT 1`,
        [customer.id],
      )) as { changes: unknown }[];
      assert.deepEqual(audit[0]?.changes, { status: ['DEPOSIT', 'WON'] });
    });

    it('chuyển tự do: nhảy bước, lùi bước, mở lại khách WON', async () => {
      const customer = await createCustomer();
      assert.equal((await changed(customer.id, { status: 'DEPOSIT' })).status, 'DEPOSIT');
      assert.equal((await changed(customer.id, { status: 'VIEWING' })).status, 'VIEWING');
      await changed(customer.id, { status: 'WON' });
      assert.equal((await changed(customer.id, { status: 'NEGOTIATING' })).status, 'NEGOTIATING');
    });

    it('sang LOST bắt buộc lý do; rời LOST thì xoá lý do; lý do gửi kèm bước khác → 400', async () => {
      const customer = await createCustomer();
      for (const payload of [
        { status: 'LOST' },
        { status: 'LOST', lostReason: '   ' },
        { status: 'LOST', lostReason: '<b>x</b>' },
        { status: 'LOST', lostReason: 'x'.repeat(1001) },
        { status: 'CONTACTED', lostReason: 'Không mua' },
      ]) {
        const error = await errorOf(await changeStatus(customer.id, payload), 400);
        assert.deepEqual(
          [...new Set(error.details?.map((detail) => detail.field))],
          ['lostReason'],
          JSON.stringify(payload),
        );
      }
      const lost = await changed(customer.id, { status: 'LOST', lostReason: '  Mua chỗ khác  ' });
      assert.equal(lost.status, 'LOST');
      assert.equal(lost.lostReason, 'Mua chỗ khác');
      const updated = await changed(customer.id, { status: 'LOST', lostReason: 'Hết tiền' });
      assert.equal(updated.lostReason, 'Hết tiền');
      const reopened = await changed(customer.id, { status: 'CONTACTED' });
      assert.equal(reopened.lostReason, null);
      const activities = await statusActivities(customer.id);
      assert.deepEqual(
        activities.map((activity) => [activity.content, activity.metadata]),
        [
          ['Mua chỗ khác', { fromStatus: 'NEW', toStatus: 'LOST' }],
          ['Hết tiền', { fromStatus: 'LOST', toStatus: 'LOST' }],
          [null, { fromStatus: 'LOST', toStatus: 'CONTACTED' }],
        ],
      );
    });

    it('đặt lại đúng bước đang có → 200, không ghi gì', async () => {
      const customer = await createCustomer();
      const same = await changed(customer.id, { status: 'NEW' });
      assert.equal(same.updatedAt, customer.updatedAt);
      assert.equal((await statusActivities(customer.id)).length, 0);
    });

    it('bước lạ, thiếu, trường lạ, expectedUpdatedAt cũ → 400/409', async () => {
      const customer = await createCustomer();
      for (const payload of [{}, { status: 'DONE' }, { status: null }]) {
        const error = await errorOf(await changeStatus(customer.id, payload), 400);
        assert.deepEqual(
          [...new Set(error.details?.map((detail) => detail.field))],
          ['status'],
          JSON.stringify(payload),
        );
      }
      assert.equal(
        (await changeStatus(customer.id, { status: 'CONTACTED', agentId: userIds['agent2'] }))
          .status,
        400,
      );
      await request('PATCH', `/customers/${customer.id}`, { notes: 'Mới' }, tokens['agent1']);
      assert.equal(
        (
          await errorOf(
            await changeStatus(customer.id, {
              status: 'CONTACTED',
              expectedUpdatedAt: customer.updatedAt,
            }),
            409,
          )
        ).code,
        'CONFLICT',
      );
    });

    it('quyền: trưởng nhóm, trưởng phòng, admin đổi được; xem được mà không sửa được → 403; ngoài phạm vi → 404', async () => {
      const customer = await createCustomer();
      for (const [user, status] of [
        ['leader', 'CONTACTED'],
        ['manager', 'QUALIFIED'],
        ['admin', 'VIEWING'],
      ] as const) {
        assert.equal((await changed(customer.id, { status }, user)).updatedBy, userIds[user]);
      }
      assert.equal(
        (await errorOf(await changeStatus(customer.id, { status: 'WON' }, 'viewer'), 403)).code,
        'FORBIDDEN',
      );
      for (const user of ['agent2', 'collab', 'agent4']) {
        assert.equal((await changeStatus(customer.id, { status: 'WON' }, user)).status, 404, user);
      }
      const other = await createCustomer(tokens['otherAdmin']);
      assert.equal((await changeStatus(other.id, { status: 'WON' }, 'admin')).status, 404);
      assert.equal((await changeStatus('abc', { status: 'WON' }, 'admin')).status, 400);
      assert.equal(
        (await request('POST', `/customers/${customer.id}/status`, { status: 'WON' })).status,
        401,
      );
      const [row] = (await db.query('SELECT status FROM customers WHERE id = $1', [
        customer.id,
      ])) as {
        status: string;
      }[];
      assert.equal(row?.status, 'VIEWING');
    });
  });

  describe('lọc và đếm theo bước', () => {
    it('GET /customers?status= lọc theo bước; GET /customers/pipeline đếm theo phạm vi xem', async () => {
      const contacted = await createCustomer();
      await changed(contacted.id, { status: 'CONTACTED' });
      const lost = await createCustomer();
      await changed(lost.id, { status: 'LOST', lostReason: 'Không liên lạc được' });
      const fresh = await createCustomer();

      const list = async (query: string): Promise<string[]> => {
        const response = await request('GET', `/customers${query}`, undefined, tokens['agent1']);
        assert.equal(response.status, 200, query);
        return ((await response.json()) as { data: Customer[] }).data.map((item) => item.id);
      };
      const contactedIds = await list('?status=CONTACTED&pageSize=100');
      assert.ok(contactedIds.includes(contacted.id));
      assert.ok(!contactedIds.includes(lost.id) && !contactedIds.includes(fresh.id));
      const both = await list('?status=CONTACTED,LOST&pageSize=100');
      assert.ok(both.includes(contacted.id) && both.includes(lost.id) && !both.includes(fresh.id));
      for (const query of ['?status=DONE', '?status=']) {
        assert.equal(
          (await request('GET', `/customers${query}`, undefined, tokens['agent1'])).status,
          400,
          query,
        );
      }

      const pipelineOf = async (token: string | undefined): Promise<Record<string, number>> => {
        const response = await request('GET', '/customers/pipeline', undefined, token);
        assert.equal(response.status, 200);
        const data = ((await response.json()) as { data: { status: string; count: number }[] })
          .data;
        assert.deepEqual(
          data.map((row) => row.status),
          ['NEW', 'CONTACTED', 'QUALIFIED', 'VIEWING', 'NEGOTIATING', 'DEPOSIT', 'WON', 'LOST'],
        );
        return Object.fromEntries(data.map((row) => [row.status, row.count]));
      };
      const [expected] = (await db.query(
        `SELECT count(*) FILTER (WHERE status = 'NEW')::int AS new,
                count(*) FILTER (WHERE status = 'LOST')::int AS lost
           FROM customers WHERE tenant_id = $1 AND deleted_at IS NULL
            AND (agent_id = $2 OR created_by = $2)`,
        [tenantA, userIds['agent1']],
      )) as { new: number; lost: number }[];
      const mine = await pipelineOf(tokens['agent1']);
      assert.equal(mine['NEW'], expected?.new);
      assert.equal(mine['LOST'], expected?.lost);
      const agent4 = await pipelineOf(tokens['agent4']);
      assert.ok(
        Object.values(agent4).every((count) => count === 0),
        'agent4 chưa có khách',
      );
      const other = await pipelineOf(tokens['otherAdmin']);
      assert.equal(other['CONTACTED'], 0, 'không đếm khách công ty khác');
      assert.equal((await request('GET', '/customers/pipeline')).status, 401);
    });
  });
});
