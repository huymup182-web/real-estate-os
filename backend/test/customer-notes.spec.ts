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

interface Note {
  id: string;
  content: string;
  user: { id: string; fullName: string };
  occurredAt: string;
  createdAt: string;
}

interface NotePage {
  data: Note[];
  meta: { page: number; pageSize: number; total: number };
}

interface ApiError {
  error: { code: string; details?: { field?: string }[] };
}

/**
 * Công ty A: admin; phòng D1 có team T1 (trưởng nhóm `leader`) gồm agent1, agent2, cộng tác viên `collab`;
 * `viewer` (role tuỳ chỉnh: xem khách COMPANY, sửa khách OWN). Mỗi test dùng khách mới của agent1.
 */
describe('/api/v1/customers/:customerId/notes', () => {
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

  async function addNote(
    customerId: string,
    payload: Record<string, unknown> = { content: 'Đã gọi, khách hẹn cuối tuần' },
    user = 'agent1',
  ): Promise<Note> {
    const response = await as(user, 'POST', `/customers/${customerId}/notes`, payload);
    assert.equal(response.status, 201, await response.clone().text());
    return ((await response.json()) as { data: Note }).data;
  }

  async function listNotes(customerId: string, user = 'agent1', query = ''): Promise<NotePage> {
    const response = await as(user, 'GET', `/customers/${customerId}/notes${query}`);
    assert.equal(response.status, 200, user);
    return (await response.json()) as NotePage;
  }

  async function errorOf(response: Response, status: number): Promise<ApiError['error']> {
    assert.equal(response.status, status);
    return ((await response.json()) as ApiError).error;
  }

  describe('POST', () => {
    it('thêm ghi chú → 201; nội dung được trim, người ghi là mình, mặc định xảy ra lúc ghi', async () => {
      const customerId = await createCustomer();
      const before = Date.now();
      const note = await addNote(customerId, { content: '  Khách thích căn góc  ' });
      assert.equal(note.content, 'Khách thích căn góc');
      assert.deepEqual(note.user, { id: userIds['agent1'], fullName: 'agent1' });
      const occurredAt = new Date(note.occurredAt).getTime();
      assert.ok(occurredAt >= before - 1000 && occurredAt <= Date.now() + 1000);

      const [row] = (await db.query(
        `SELECT tenant_id, customer_id, user_id, type FROM customer_activities WHERE id = $1`,
        [note.id],
      )) as { tenant_id: string; customer_id: string; user_id: string; type: string }[];
      assert.deepEqual(row, {
        tenant_id: tenantA,
        customer_id: customerId,
        user_id: userIds['agent1'],
        type: 'NOTE',
      });
    });

    it('ghi lại việc đã xảy ra trước đó bằng occurredAt', async () => {
      const customerId = await createCustomer();
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const note = await addNote(customerId, { content: 'Gặp hôm qua', occurredAt: yesterday });
      assert.equal(note.occurredAt, yesterday);
    });

    it('dữ liệu sai → 400 kèm trường lỗi', async () => {
      const customerId = await createCustomer();
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      for (const [payload, field] of [
        [{}, 'content'],
        [{ content: '   ' }, 'content'],
        [{ content: 'x'.repeat(5001) }, 'content'],
        [{ content: '<script>x</script>' }, 'content'],
        [{ content: 123 }, 'content'],
        [{ content: 'Ok', occurredAt: 'hôm qua' }, 'occurredAt'],
        [{ content: 'Ok', occurredAt: tomorrow }, 'occurredAt'],
        [{ content: 'Ok', type: 'CALL' }, 'type'],
        [{ content: 'Ok', userId: userIds['agent2'] }, 'userId'],
      ] as const) {
        const error = await errorOf(
          await as('agent1', 'POST', `/customers/${customerId}/notes`, payload),
          400,
        );
        assert.ok(
          error.details?.some((detail) => detail.field === field),
          `${field}: ${JSON.stringify(error.details)}`,
        );
      }
      assert.equal((await listNotes(customerId)).meta.total, 0);
    });

    it('quyền: trưởng nhóm, admin ghi được; CTV ghi cho khách của mình', async () => {
      const customerId = await createCustomer();
      for (const user of ['leader', 'admin']) {
        assert.equal((await addNote(customerId, { content: user }, user)).user.id, userIds[user]);
      }
      const collabCustomer = await createCustomer('collab');
      await addNote(collabCustomer, { content: 'CTV ghi' }, 'collab');
    });

    it('xem được mà không sửa được khách → 403; không xem được → 404; chưa đăng nhập → 401', async () => {
      const customerId = await createCustomer();
      const payload = { content: 'Không được ghi' };
      assert.equal(
        (await errorOf(await as('viewer', 'POST', `/customers/${customerId}/notes`, payload), 403))
          .code,
        'FORBIDDEN',
      );
      for (const user of ['agent2', 'collab']) {
        assert.equal(
          (await as(user, 'POST', `/customers/${customerId}/notes`, payload)).status,
          404,
          user,
        );
      }
      assert.equal(
        (await request('POST', `/customers/${customerId}/notes`, payload, tokens['otherAdmin']))
          .status,
        404,
      );
      assert.equal(
        (await as('agent1', 'POST', `/customers/${MISSING}/notes`, payload)).status,
        404,
      );
      assert.equal((await as('agent1', 'POST', '/customers/abc/notes', payload)).status, 400);
      assert.equal((await request('POST', `/customers/${customerId}/notes`, payload)).status, 401);
      assert.equal((await listNotes(customerId)).meta.total, 0);
    });
  });

  describe('GET', () => {
    it('chỉ ghi chú của khách này, xảy ra gần đây trước, có phân trang', async () => {
      const customerId = await createCustomer();
      const hoursAgo = (hours: number): string =>
        new Date(Date.now() - hours * 3600 * 1000).toISOString();
      const old = await addNote(customerId, { content: 'Cũ nhất', occurredAt: hoursAgo(48) });
      const latest = await addNote(customerId, { content: 'Mới nhất' });
      const middle = await addNote(customerId, { content: 'Giữa', occurredAt: hoursAgo(5) });
      const otherCustomer = await createCustomer();
      await addNote(otherCustomer, { content: 'Khách khác' });
      await db.query(
        `INSERT INTO customer_activities (tenant_id, customer_id, user_id, type, content)
         VALUES ($1, $2, $3, 'CALL', 'Cuộc gọi, không phải ghi chú')`,
        [tenantA, customerId, userIds['agent1']],
      );

      for (const user of ['agent1', 'leader', 'viewer', 'admin']) {
        const page = await listNotes(customerId, user);
        assert.deepEqual(
          page.data.map((note) => note.id),
          [latest.id, middle.id, old.id],
          user,
        );
        assert.equal(page.meta.total, 3);
      }
      const second = await listNotes(customerId, 'agent1', '?page=2&pageSize=2');
      assert.deepEqual(
        second.data.map((note) => note.id),
        [old.id],
      );
      assert.equal(second.meta.total, 3);
      assert.equal(
        (await as('agent1', 'GET', `/customers/${customerId}/notes?pageSize=0`)).status,
        400,
      );
    });

    it('không xem được khách, công ty khác, khách đã xoá → 404; chưa đăng nhập → 401', async () => {
      const customerId = await createCustomer();
      await addNote(customerId);
      assert.equal((await as('agent2', 'GET', `/customers/${customerId}/notes`)).status, 404);
      assert.equal(
        (await request('GET', `/customers/${customerId}/notes`, undefined, tokens['otherAdmin']))
          .status,
        404,
      );
      assert.equal((await request('GET', `/customers/${customerId}/notes`)).status, 401);
      assert.equal((await as('admin', 'DELETE', `/customers/${customerId}`)).status, 204);
      assert.equal((await as('admin', 'GET', `/customers/${customerId}/notes`)).status, 404);
      const [row] = (await db.query(
        `SELECT count(*)::int AS n FROM customer_activities WHERE customer_id = $1`,
        [customerId],
      )) as { n: number }[];
      assert.equal(row?.n, 1, 'ghi chú vẫn giữ trong database');
    });

    it('ghi chú không sửa, không xoá được', async () => {
      const customerId = await createCustomer();
      const note = await addNote(customerId);
      for (const method of ['PATCH', 'PUT', 'DELETE']) {
        assert.equal(
          (await as('admin', method, `/customers/${customerId}/notes/${note.id}`, { content: 'x' }))
            .status,
          404,
          method,
        );
      }
      assert.equal((await listNotes(customerId)).data[0]?.content, note.content);
    });
  });
});
