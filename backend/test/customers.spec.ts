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
  fullName: string;
  phone: string;
  email: string | null;
  purpose: string | null;
  purchaseTimeline: string | null;
  source: string | null;
  agentId: string | null;
  status: string;
  notes: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  updatedAt: string;
  [key: string]: unknown;
}

interface ApiError {
  error: { code: string; details?: { field?: string }[] };
}

/**
 * Công ty A: admin; phòng D1 có `manager` (MANAGER), team T1 (trưởng nhóm `leader`) gồm agent1, agent2,
 * cộng tác viên `collab`; phòng D2 có agent4, `manager2` (MANAGER); `viewer` (role tuỳ chỉnh: xem COMPANY,
 * sửa OWN, không có quyền xoá).
 */
describe('/api/v1/customers', () => {
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
      ['manager', 'MANAGER', d1],
      ['leader', 'TEAM_LEADER', d1],
      ['agent1', 'AGENT', d1],
      ['agent2', 'AGENT', d1],
      ['collab', 'COLLABORATOR', d1],
      ['agent4', 'AGENT', d2],
      ['manager2', 'MANAGER', d2],
      ['viewer', 'CUSTOMER_VIEWER', d2],
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

  async function createCustomer(user = 'agent1', token = tokens[user]): Promise<Customer> {
    const response = await request(
      'POST',
      '/customers',
      { fullName: 'Nguyễn Văn Khách', phone: '+84901234567', source: 'FACEBOOK' },
      token,
    );
    assert.equal(response.status, 201);
    return ((await response.json()) as { data: Customer }).data;
  }

  async function errorOf(response: Response, status: number): Promise<ApiError['error']> {
    assert.equal(response.status, status);
    return ((await response.json()) as ApiError).error;
  }

  async function auditOf(
    id: string,
  ): Promise<{ action: string; user_id: string; changes: unknown }[]> {
    return (await db.query(
      `SELECT action, user_id, changes FROM audit_logs
        WHERE entity_type = 'customer' AND entity_id = $1 ORDER BY created_at, id`,
      [id],
    )) as { action: string; user_id: string; changes: unknown }[];
  }

  describe('POST /customers', () => {
    it('tạo khách → 201; người tạo phụ trách, trạng thái NEW, chuỗi được trim; ghi nhật ký', async () => {
      const response = await as('agent1', 'POST', '/customers', {
        fullName: '  Trần Thị Mua  ',
        phone: ' +84912345678 ',
        email: 'Mua@Example.vn',
        purpose: 'INVESTMENT',
        purchaseTimeline: 'WITHIN_3_MONTHS',
        source: 'ZALO',
        notes: '  Cần nhà gần trường  ',
      });
      assert.equal(response.status, 201);
      const customer = ((await response.json()) as { data: Customer }).data;
      assert.equal(customer.fullName, 'Trần Thị Mua');
      assert.equal(customer.phone, '+84912345678');
      assert.equal(customer.email, 'Mua@Example.vn');
      assert.equal(customer.purpose, 'INVESTMENT');
      assert.equal(customer.purchaseTimeline, 'WITHIN_3_MONTHS');
      assert.equal(customer.source, 'ZALO');
      assert.equal(customer.notes, 'Cần nhà gần trường');
      assert.equal(customer.status, 'NEW');
      assert.equal(customer.agentId, userIds['agent1']);
      assert.equal(customer.createdBy, userIds['agent1']);
      assert.equal(customer.updatedBy, userIds['agent1']);
      assert.equal('tenantId' in customer, false);
      assert.equal('deletedAt' in customer, false);

      const [row] = (await db.query('SELECT tenant_id FROM customers WHERE id = $1', [
        customer.id,
      ])) as { tenant_id: string }[];
      assert.equal(row?.tenant_id, tenantA);
      const audit = await auditOf(customer.id);
      assert.deepEqual(
        audit.map((entry) => [entry.action, entry.user_id]),
        [['customer.create', userIds['agent1']]],
      );
    });

    it('chỉ gửi tên và SĐT: các trường khác null; cùng SĐT tạo lần hai vẫn được', async () => {
      const first = await createCustomer();
      const second = await createCustomer();
      assert.notEqual(first.id, second.id);
      assert.equal(first.email, null);
      assert.equal(first.purpose, null);
      assert.equal(first.notes, null);
    });

    it('cộng tác viên tạo được khách', async () => {
      const customer = await createCustomer('collab');
      assert.equal(customer.agentId, userIds['collab']);
    });

    it('dữ liệu sai → 400 kèm trường lỗi', async () => {
      const valid = { fullName: 'Khách', phone: '+84901234567' };
      for (const [payload, field] of [
        [{ phone: '+84901234567' }, 'fullName'],
        [{ ...valid, fullName: '   ' }, 'fullName'],
        [{ ...valid, fullName: 'x'.repeat(256) }, 'fullName'],
        [{ ...valid, fullName: '<b>Khách</b>' }, 'fullName'],
        [{ fullName: 'Khách' }, 'phone'],
        [{ ...valid, phone: '0901234567' }, 'phone'],
        [{ ...valid, phone: '+84 901 234 567' }, 'phone'],
        [{ ...valid, email: 'khong-phai-email' }, 'email'],
        [{ ...valid, purpose: 'BUY' }, 'purpose'],
        [{ ...valid, purchaseTimeline: 'SOON' }, 'purchaseTimeline'],
        [{ ...valid, source: 'GOOGLE' }, 'source'],
        [{ ...valid, notes: '<script>x</script>' }, 'notes'],
        [{ ...valid, notes: 'x'.repeat(5001) }, 'notes'],
        [{ ...valid, status: 'WON' }, 'status'],
        [{ ...valid, agentId: userIds['agent2'] }, 'agentId'],
        [{ ...valid, tenantId: tenantA }, 'tenantId'],
      ] as const) {
        const error = await errorOf(await as('agent1', 'POST', '/customers', payload), 400);
        assert.equal(error.code, 'VALIDATION_ERROR', field);
        assert.ok(
          error.details?.some((detail) => detail.field === field),
          `${field}: ${JSON.stringify(error.details)}`,
        );
      }
    });

    it('chưa đăng nhập → 401', async () => {
      assert.equal(
        (await request('POST', '/customers', { fullName: 'Khách', phone: '+84901234567' })).status,
        401,
      );
    });
  });

  describe('GET /customers/:id', () => {
    it('xem theo phạm vi: OWN, TEAM, DEPARTMENT, COMPANY; ngoài phạm vi → 404', async () => {
      const customer = await createCustomer('agent1');
      for (const user of ['agent1', 'leader', 'manager', 'admin', 'viewer']) {
        const response = await as(user, 'GET', `/customers/${customer.id}`);
        assert.equal(response.status, 200, user);
        assert.equal(((await response.json()) as { data: Customer }).data.id, customer.id);
      }
      for (const user of ['agent2', 'collab', 'agent4', 'manager2']) {
        assert.equal(
          (await errorOf(await as(user, 'GET', `/customers/${customer.id}`), 404)).code,
          'NOT_FOUND',
          user,
        );
      }
    });

    it('không tồn tại, công ty khác → 404; id sai → 400; chưa đăng nhập → 401', async () => {
      assert.equal(
        (await as('admin', 'GET', '/customers/00000000-0000-4000-8000-000000000000')).status,
        404,
      );
      const other = await createCustomer('_', tokens['otherAdmin']);
      assert.equal((await as('admin', 'GET', `/customers/${other.id}`)).status, 404);
      assert.equal((await as('admin', 'GET', '/customers/abc')).status, 400);
      assert.equal((await request('GET', `/customers/${other.id}`)).status, 401);
    });
  });

  describe('GET /customers', () => {
    it('chỉ gồm khách trong phạm vi xem, mới tạo trước, có phân trang', async () => {
      const mine = await createCustomer('agent4');
      const others = await createCustomer('agent2');

      const listOf = async (user: string, query = '?pageSize=100') => {
        const response = await as(user, 'GET', `/customers${query}`);
        assert.equal(response.status, 200, user);
        return (await response.json()) as {
          data: Customer[];
          meta: { page: number; pageSize: number; total: number };
        };
      };

      const agent4 = await listOf('agent4');
      assert.ok(agent4.data.length > 0);
      assert.ok(agent4.data.every((item) => item.agentId === userIds['agent4']));
      assert.ok(agent4.data.some((item) => item.id === mine.id));
      assert.equal(agent4.meta.total, agent4.data.length);

      const admin = await listOf('admin');
      const ids = admin.data.map((item) => item.id);
      assert.ok(ids.includes(mine.id) && ids.includes(others.id));
      assert.ok(ids.indexOf(others.id) < ids.indexOf(mine.id), 'mới tạo trước');
      const [count] = (await db.query(
        'SELECT count(*)::int AS n FROM customers WHERE tenant_id = $1 AND deleted_at IS NULL',
        [tenantA],
      )) as { n: number }[];
      assert.equal(admin.meta.total, count?.n);

      const manager2 = await listOf('manager2');
      assert.ok(manager2.data.some((item) => item.id === mine.id));
      assert.equal(
        manager2.data.some((item) => item.id === others.id),
        false,
      );

      const firstPage = await listOf('admin', '?page=1&pageSize=1');
      assert.equal(firstPage.data.length, 1);
      assert.equal(firstPage.data[0]?.id, others.id);
      assert.deepEqual(
        { page: firstPage.meta.page, pageSize: firstPage.meta.pageSize },
        { page: 1, pageSize: 1 },
      );
      assert.equal((await as('admin', 'GET', '/customers?page=0')).status, 400);
      assert.equal((await request('GET', '/customers')).status, 401);
    });
  });

  describe('PATCH /customers/:id', () => {
    it('sửa trường được gửi → 200; null xoá giá trị; ghi nhật ký thay đổi', async () => {
      const customer = await createCustomer();
      const response = await as('agent1', 'PATCH', `/customers/${customer.id}`, {
        fullName: ' Nguyễn Văn Mới ',
        email: 'moi@example.vn',
        purpose: 'LIVING',
        source: null,
        expectedUpdatedAt: customer.updatedAt,
      });
      assert.equal(response.status, 200);
      const updated = ((await response.json()) as { data: Customer }).data;
      assert.equal(updated.fullName, 'Nguyễn Văn Mới');
      assert.equal(updated.email, 'moi@example.vn');
      assert.equal(updated.purpose, 'LIVING');
      assert.equal(updated.source, null);
      assert.equal(updated.phone, customer.phone);
      assert.equal(updated.status, 'NEW');

      const cleared = await as('agent1', 'PATCH', `/customers/${customer.id}`, { email: '' });
      assert.equal(((await cleared.json()) as { data: Customer }).data.email, null);

      const audit = await auditOf(customer.id);
      assert.deepEqual(
        audit.map((entry) => entry.action),
        ['customer.create', 'customer.update', 'customer.update'],
      );
      assert.deepEqual(audit[1]?.changes, {
        fullName: ['Nguyễn Văn Khách', 'Nguyễn Văn Mới'],
        email: [null, 'moi@example.vn'],
        purpose: [null, 'LIVING'],
        source: ['FACEBOOK', null],
      });
    });

    it('gửi lại đúng giá trị cũ: không ghi nhật ký', async () => {
      const customer = await createCustomer();
      const response = await as('agent1', 'PATCH', `/customers/${customer.id}`, {
        phone: customer.phone,
      });
      assert.equal(response.status, 200);
      assert.equal((await auditOf(customer.id)).length, 1);
    });

    it('người sửa: trưởng nhóm, trưởng phòng, admin → 200 và ghi updatedBy', async () => {
      const customer = await createCustomer();
      for (const user of ['leader', 'manager', 'admin']) {
        const response = await as(user, 'PATCH', `/customers/${customer.id}`, { notes: user });
        assert.equal(response.status, 200, user);
        assert.equal(((await response.json()) as { data: Customer }).data.updatedBy, userIds[user]);
      }
    });

    it('xem được nhưng ngoài phạm vi sửa → 403; ngoài phạm vi xem → 404', async () => {
      const customer = await createCustomer();
      assert.equal(
        (
          await errorOf(
            await as('viewer', 'PATCH', `/customers/${customer.id}`, { notes: 'x' }),
            403,
          )
        ).code,
        'FORBIDDEN',
      );
      for (const user of ['agent2', 'collab', 'manager2']) {
        assert.equal(
          (await as(user, 'PATCH', `/customers/${customer.id}`, { notes: 'x' })).status,
          404,
          user,
        );
      }
      const [row] = (await db.query('SELECT notes FROM customers WHERE id = $1', [
        customer.id,
      ])) as {
        notes: string | null;
      }[];
      assert.equal(row?.notes, null);
    });

    it('expectedUpdatedAt cũ → 409', async () => {
      const customer = await createCustomer();
      assert.equal(
        (await as('agent1', 'PATCH', `/customers/${customer.id}`, { notes: 'lần 1' })).status,
        200,
      );
      const error = await errorOf(
        await as('agent1', 'PATCH', `/customers/${customer.id}`, {
          notes: 'lần 2',
          expectedUpdatedAt: customer.updatedAt,
        }),
        409,
      );
      assert.equal(error.code, 'CONFLICT');
    });

    it('dữ liệu sai → 400: body rỗng, tên/SĐT null, trạng thái, môi giới', async () => {
      const customer = await createCustomer();
      for (const payload of [
        {},
        { fullName: null },
        { fullName: '' },
        { phone: null },
        { phone: '12345' },
        { email: 'sai' },
        { purpose: 'BUY' },
        { status: 'WON' },
        { agentId: userIds['agent2'] },
        { lostReason: 'x' },
        { expectedUpdatedAt: 'hôm qua' },
      ]) {
        assert.equal(
          (await as('agent1', 'PATCH', `/customers/${customer.id}`, payload)).status,
          400,
          JSON.stringify(payload),
        );
      }
    });
  });

  describe('DELETE /customers/:id', () => {
    const remove = (id: string, user: string) => as(user, 'DELETE', `/customers/${id}`);

    it('trưởng phòng cùng phòng xoá được → 204; còn trong DB nhưng không đọc được nữa', async () => {
      const customer = await createCustomer();
      const response = await remove(customer.id, 'manager');
      assert.equal(response.status, 204);
      assert.equal(await response.text(), '');

      const [row] = (await db.query('SELECT deleted_at, updated_by FROM customers WHERE id = $1', [
        customer.id,
      ])) as { deleted_at: Date | null; updated_by: string }[];
      assert.ok(row?.deleted_at);
      assert.equal(row.updated_by, userIds['manager']);
      assert.equal((await as('admin', 'GET', `/customers/${customer.id}`)).status, 404);
      const list = (await (await as('admin', 'GET', '/customers?pageSize=100')).json()) as {
        data: { id: string }[];
      };
      assert.equal(
        list.data.some((item) => item.id === customer.id),
        false,
      );
      assert.equal((await remove(customer.id, 'manager')).status, 404, 'xoá lần 2');
      assert.deepEqual(
        (await auditOf(customer.id)).map((entry) => [entry.action, entry.user_id]),
        [
          ['customer.create', userIds['agent1']],
          ['customer.delete', userIds['manager']],
        ],
      );
    });

    it('không có customer.delete (môi giới, trưởng nhóm, CTV) → 403; trưởng phòng khác phòng → 404', async () => {
      const customer = await createCustomer();
      for (const user of ['agent1', 'leader', 'viewer']) {
        assert.equal((await errorOf(await remove(customer.id, user), 403)).code, 'FORBIDDEN', user);
      }
      const own = await createCustomer('collab');
      assert.equal((await remove(own.id, 'collab')).status, 403);
      assert.equal((await remove(customer.id, 'manager2')).status, 404);
      assert.equal((await remove(customer.id, 'admin')).status, 204);
    });

    it('công ty khác → 404 và không bị xoá', async () => {
      const other = await createCustomer('_', tokens['otherAdmin']);
      assert.equal((await remove(other.id, 'admin')).status, 404);
      const [row] = (await db.query('SELECT deleted_at FROM customers WHERE id = $1', [
        other.id,
      ])) as { deleted_at: Date | null }[];
      assert.equal(row?.deleted_at, null);
    });
  });
});
