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

interface Activity {
  id: string;
  type: string;
  content: string | null;
  propertyIds: string[] | null;
  metadata: Record<string, unknown>;
  user: { id: string; fullName: string };
  occurredAt: string;
  createdAt: string;
}

interface ActivityPage {
  data: Activity[];
  meta: { page: number; pageSize: number; total: number };
}

interface ApiError {
  error: { code: string; details?: { field?: string }[] };
}

/**
 * Công ty A: admin; phòng D1 có team T1 (trưởng nhóm `leader`) gồm agent1, agent2, cộng tác viên `collab`;
 * `viewer` (role tuỳ chỉnh: xem khách COMPANY, sửa khách OWN). Mỗi test dùng khách mới của agent1.
 * BĐS: mọi role xem được BĐS cả công ty (trừ BĐS ẩn với người không sửa được).
 */
describe('/api/v1/customers/:customerId/activities', () => {
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
    for (const [name, role] of [
      ['leader', 'TEAM_LEADER'],
      ['agent1', 'AGENT'],
      ['agent2', 'AGENT'],
      ['collab', 'COLLABORATOR'],
      ['viewer', 'CUSTOMER_VIEWER'],
    ] as const) {
      userIds[name] = await insertUser(name, hash, d1, role);
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

  async function createCustomer(user = 'agent1'): Promise<string> {
    const response = await as(user, 'POST', '/customers', {
      fullName: 'Khách được chăm sóc',
      phone: '+84901234567',
    });
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

  async function log(
    customerId: string,
    payload: Record<string, unknown>,
    user = 'agent1',
  ): Promise<Activity> {
    const response = await as(user, 'POST', `/customers/${customerId}/activities`, payload);
    assert.equal(response.status, 201, await response.clone().text());
    return ((await response.json()) as { data: Activity }).data;
  }

  async function timeline(customerId: string, user = 'agent1', query = ''): Promise<ActivityPage> {
    const response = await as(user, 'GET', `/customers/${customerId}/activities${query}`);
    assert.equal(response.status, 200, `${user} ${query}`);
    return (await response.json()) as ActivityPage;
  }

  async function errorOf(response: Response, status: number): Promise<ApiError['error']> {
    assert.equal(response.status, status);
    return ((await response.json()) as ApiError).error;
  }

  describe('POST', () => {
    it('ghi từng loại hoạt động người dùng ghi được → 201', async () => {
      const customerId = await createCustomer();
      const propertyId = await createProperty();
      const call = await log(customerId, { type: 'CALL', content: '  Gọi 5 phút  ' });
      assert.equal(call.type, 'CALL');
      assert.equal(call.content, 'Gọi 5 phút');
      assert.equal(call.propertyIds, null);
      assert.deepEqual(call.metadata, {});
      assert.deepEqual(call.user, { id: userIds['agent1'], fullName: 'agent1' });

      const bare = await log(customerId, { type: 'MESSAGE', content: '   ' });
      assert.equal(bare.content, null, 'nội dung rỗng coi như không có');

      const sent = await log(customerId, {
        type: 'PROPERTY_SENT',
        propertyIds: [propertyId, propertyId],
      });
      assert.deepEqual(sent.propertyIds, [propertyId]);

      for (const type of ['VIEWING', 'NEGOTIATION', 'DEPOSIT']) {
        const activity = await log(customerId, { type, propertyIds: [propertyId] });
        assert.equal(activity.type, type);
      }
      const note = await log(customerId, { type: 'NOTE', content: 'Khách thích hướng Đông' });
      assert.equal(note.type, 'NOTE');
      assert.equal((await timeline(customerId)).meta.total, 7);
    });

    it('dữ liệu sai → 400 kèm trường lỗi', async () => {
      const customerId = await createCustomer();
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      for (const [payload, field] of [
        [{}, 'type'],
        [{ type: 'MEETING' }, 'type'],
        [{ type: 'STATUS_CHANGE' }, 'type'],
        [{ type: 'ASSIGNMENT' }, 'type'],
        [{ type: 'NOTE' }, 'content'],
        [{ type: 'NOTE', content: '  ' }, 'content'],
        [{ type: 'CALL', content: '<b>x</b>' }, 'content'],
        [{ type: 'CALL', content: 'x'.repeat(5001) }, 'content'],
        [{ type: 'PROPERTY_SENT' }, 'propertyIds'],
        [{ type: 'PROPERTY_SENT', propertyIds: [] }, 'propertyIds'],
        [{ type: 'VIEWING', propertyIds: ['abc'] }, 'propertyIds'],
        [{ type: 'VIEWING', propertyIds: MISSING }, 'propertyIds'],
        [{ type: 'CALL', occurredAt: tomorrow }, 'occurredAt'],
        [{ type: 'CALL', metadata: { x: 1 } }, 'metadata'],
        [{ type: 'CALL', userId: userIds['agent2'] }, 'userId'],
      ] as const) {
        const error = await errorOf(
          await as('agent1', 'POST', `/customers/${customerId}/activities`, payload),
          400,
        );
        assert.ok(
          error.details?.some((detail) => detail.field === field),
          `${JSON.stringify(payload)}: ${JSON.stringify(error.details)}`,
        );
      }
      assert.equal((await timeline(customerId)).meta.total, 0);
    });

    it('BĐS không xem được (không có, công ty khác, BĐS ẩn của người khác) → 400 propertyIds', async () => {
      const customerId = await createCustomer();
      const hidden = await createProperty(tokens['agent2']);
      await db.query(`UPDATE properties SET status = 'HIDDEN' WHERE id = $1`, [hidden]);
      const otherTenant = await createProperty(tokens['otherAdmin']);
      for (const propertyId of [MISSING, otherTenant, hidden]) {
        const error = await errorOf(
          await as('agent1', 'POST', `/customers/${customerId}/activities`, {
            type: 'PROPERTY_SENT',
            propertyIds: [propertyId],
          }),
          400,
        );
        assert.deepEqual(
          error.details?.map((detail) => detail.field),
          ['propertyIds'],
          propertyId,
        );
      }
      // Người sửa được BĐS ẩn (agent2) thì gắn được.
      const agent2Customer = await createCustomer('agent2');
      await log(agent2Customer, { type: 'PROPERTY_SENT', propertyIds: [hidden] }, 'agent2');
    });

    it('quyền: không sửa được khách → 403; không xem được → 404; chưa đăng nhập → 401', async () => {
      const customerId = await createCustomer();
      const payload = { type: 'CALL' };
      assert.equal(
        (
          await errorOf(
            await as('viewer', 'POST', `/customers/${customerId}/activities`, payload),
            403,
          )
        ).code,
        'FORBIDDEN',
      );
      for (const user of ['agent2', 'collab']) {
        assert.equal(
          (await as(user, 'POST', `/customers/${customerId}/activities`, payload)).status,
          404,
          user,
        );
      }
      assert.equal(
        (
          await request(
            'POST',
            `/customers/${customerId}/activities`,
            payload,
            tokens['otherAdmin'],
          )
        ).status,
        404,
      );
      assert.equal(
        (await request('POST', `/customers/${customerId}/activities`, payload)).status,
        401,
      );
      await log(customerId, payload, 'leader');
      assert.equal((await timeline(customerId)).meta.total, 1);
    });
  });

  describe('GET', () => {
    it('timeline gồm ghi chú và việc giao khách, xảy ra gần đây trước; lọc theo loại; phân trang', async () => {
      const customerId = await createCustomer();
      const hoursAgo = (hours: number): string =>
        new Date(Date.now() - hours * 3600 * 1000).toISOString();
      const call = await log(customerId, { type: 'CALL', occurredAt: hoursAgo(48) });
      const noteResponse = await as('agent1', 'POST', `/customers/${customerId}/notes`, {
        content: 'Ghi chú qua /notes',
        occurredAt: hoursAgo(24),
      });
      assert.equal(noteResponse.status, 201);
      const note = ((await noteResponse.json()) as { data: Activity }).data;
      assert.equal(note.type, 'NOTE');
      assert.equal(
        (
          await as('leader', 'POST', `/customers/${customerId}/assign`, {
            agentId: userIds['agent2'],
          })
        ).status,
        200,
      );
      await log(await createCustomer(), { type: 'CALL' });

      for (const user of ['agent1', 'agent2', 'leader', 'viewer', 'admin']) {
        const page = await timeline(customerId, user);
        assert.deepEqual(
          page.data.map((activity) => activity.type),
          ['ASSIGNMENT', 'NOTE', 'CALL'],
          user,
        );
        assert.equal(page.meta.total, 3);
      }
      const [assignment] = (await timeline(customerId)).data;
      assert.deepEqual(assignment?.user, { id: userIds['leader'], fullName: 'leader' });
      assert.deepEqual(assignment?.metadata, {
        fromAgentId: userIds['agent1'],
        toAgentId: userIds['agent2'],
      });

      assert.deepEqual(
        (await timeline(customerId, 'agent1', '?type=CALL,NOTE')).data.map((a) => a.id),
        [note.id, call.id],
      );
      assert.deepEqual(
        (await timeline(customerId, 'agent1', '?type=ASSIGNMENT&type=CALL')).meta.total,
        2,
      );
      const notes = (await (
        await as('agent1', 'GET', `/customers/${customerId}/notes`)
      ).json()) as ActivityPage;
      assert.deepEqual(
        notes.data.map((a) => a.id),
        [note.id],
      );
      const second = await timeline(customerId, 'agent1', '?page=2&pageSize=2');
      assert.deepEqual(
        second.data.map((a) => a.id),
        [call.id],
      );
      for (const query of ['?type=MEETING', '?type=', '?pageSize=0']) {
        assert.equal(
          (await as('agent1', 'GET', `/customers/${customerId}/activities${query}`)).status,
          400,
          query,
        );
      }
    });

    it('không xem được khách, công ty khác, khách đã xoá → 404; chưa đăng nhập → 401', async () => {
      const customerId = await createCustomer();
      await log(customerId, { type: 'CALL' });
      assert.equal((await as('collab', 'GET', `/customers/${customerId}/activities`)).status, 404);
      assert.equal(
        (
          await request(
            'GET',
            `/customers/${customerId}/activities`,
            undefined,
            tokens['otherAdmin'],
          )
        ).status,
        404,
      );
      assert.equal((await request('GET', `/customers/${customerId}/activities`)).status, 401);
      assert.equal((await as('admin', 'DELETE', `/customers/${customerId}`)).status, 204);
      assert.equal((await as('admin', 'GET', `/customers/${customerId}/activities`)).status, 404);
    });

    it('hoạt động không sửa, không xoá được', async () => {
      const customerId = await createCustomer();
      const activity = await log(customerId, { type: 'CALL', content: 'Gốc' });
      for (const method of ['PATCH', 'PUT', 'DELETE']) {
        assert.equal(
          (
            await as(
              method === 'DELETE' ? 'admin' : 'agent1',
              method,
              `/customers/${customerId}/activities/${activity.id}`,
              {
                content: 'x',
              },
            )
          ).status,
          404,
          method,
        );
      }
      await assert.rejects(
        db.query(`UPDATE customer_activities SET content = 'x' WHERE id = $1`, [activity.id]),
        /customer_activities_append_only/,
      );
    });
  });
});
