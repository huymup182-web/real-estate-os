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

interface Detail {
  id: string;
  updatedAt: string;
  updatedBy: string | null;
  ownerContactVisible: boolean;
  [key: string]: unknown;
}

interface ApiError {
  error: { code: string; details?: { field?: string }[] };
}

/**
 * Công ty A: admin; phòng D1 có `manager` (MANAGER), team T1 (trưởng nhóm `leader`) gồm agent1, agent2;
 * phòng D2 có agent4; `ownOnly` (role tuỳ chỉnh: property.view/create/edit phạm vi OWN).
 * Mỗi test dùng BĐS mới do agent1 tạo (trừ khi ghi khác).
 */
describe('POST /api/v1/properties/:id/status', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let tenantA: string;
  let khanhHoa: string;
  let nhaTrang: string;
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
    nhaTrang = await insertId(
      `INSERT INTO districts (province_id, code, name) VALUES ($1, '568', 'Nha Trang')`,
      [khanhHoa],
    );
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
      ['agent4', 'AGENT', d2],
    ] as const) {
      userIds[name] = await insertUser(name, hash, department, role);
    }
    const team = await insertId(
      `INSERT INTO teams (tenant_id, department_id, name, leader_id) VALUES ($1, $2, 'T1', $3)`,
      [tenantA, d1, userIds['leader']],
    );
    for (const name of ['agent1', 'agent2']) {
      await db.query(`INSERT INTO team_members (tenant_id, team_id, user_id) VALUES ($1, $2, $3)`, [
        tenantA,
        team,
        userIds[name],
      ]);
    }
    const ownRole = await insertId(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'OWN_EDITOR', 'Chỉ BĐS của mình')`,
      [tenantA],
    );
    await db.query(
      `INSERT INTO role_permissions (role_id, permission_id, scope)
       SELECT $1, id, 'OWN' FROM permissions
        WHERE code IN ('property.view', 'property.create', 'property.edit')`,
      [ownRole],
    );
    userIds['ownOnly'] = await insertUser('ownOnly', hash, null, 'OWN_EDITOR');

    for (const name of Object.keys(userIds)) {
      tokens[name] = await login(`${name}@a.vn`);
    }
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

  async function createProperty(user = 'agent1', token = tokens[user]): Promise<Detail> {
    const response = await request(
      'POST',
      '/properties',
      {
        title: 'Nhà phố Vĩnh Hải',
        description: 'Gần biển',
        propertyType: 'HOUSE',
        price: 3_500_000_000,
        area: 70,
        provinceId: khanhHoa,
        districtId: nhaTrang,
        wardId: vinhHai,
        streetAddress: '12 Đường 2/4',
        latitude: 12.276543,
        longitude: 109.198765,
        commissionType: 'PERCENT',
        commissionValue: 1.5,
      },
      token,
    );
    assert.equal(response.status, 201);
    return ((await response.json()) as { data: Detail }).data;
  }

  function setStatus(id: string, payload: unknown, user = 'agent1'): Promise<Response> {
    return request('POST', `/properties/${id}/status`, payload, tokens[user]);
  }

  async function statusSet(id: string, status: string, user = 'agent1'): Promise<Detail> {
    const response = await setStatus(id, { status }, user);
    assert.equal(response.status, 200, `${user}: ${JSON.stringify(await response.clone().json())}`);
    return ((await response.json()) as { data: Detail }).data;
  }

  function get(id: string, user: string): Promise<Response> {
    return request('GET', `/properties/${id}`, undefined, tokens[user]);
  }

  async function listedIds(user: string): Promise<string[]> {
    const response = await request('GET', '/properties?pageSize=100', undefined, tokens[user]);
    assert.equal(response.status, 200);
    return ((await response.json()) as { data: { id: string }[] }).data.map((item) => item.id);
  }

  async function errorOf(response: Response, status: number): Promise<ApiError['error']> {
    assert.equal(response.status, status);
    return ((await response.json()) as ApiError).error;
  }

  async function invalidFields(id: string, payload: unknown): Promise<string[]> {
    const error = await errorOf(await setStatus(id, payload), 400);
    assert.equal(error.code, 'VALIDATION_ERROR');
    return [...new Set((error.details ?? []).map((detail) => detail.field ?? ''))].sort();
  }

  async function statusInDb(id: string): Promise<string> {
    const [row] = (await db.query('SELECT status FROM properties WHERE id = $1', [id])) as {
      status: string;
    }[];
    return row?.status ?? '';
  }

  it('người phụ trách chuyển tự do giữa AVAILABLE, PENDING, SOLD, HIDDEN; ghi người đổi', async () => {
    const property = await createProperty();
    for (const status of ['PENDING', 'SOLD', 'AVAILABLE', 'HIDDEN', 'SOLD', 'PENDING']) {
      const data = await statusSet(property.id, status);
      assert.equal(data['status'], status);
      assert.equal(data.updatedBy, userIds['agent1']);
    }
  });

  it('đặt lại đúng trạng thái đang có → 200, không ghi gì', async () => {
    const property = await createProperty();
    const data = await statusSet(property.id, 'AVAILABLE');
    assert.equal(data.updatedAt, property.updatedAt);
  });

  it('xem được nhưng ngoài phạm vi sửa → 403; trưởng nhóm, trưởng phòng, admin đổi được', async () => {
    const property = await createProperty();
    for (const user of ['agent2', 'agent4']) {
      assert.equal(
        (await errorOf(await setStatus(property.id, { status: 'SOLD' }, user), 403)).code,
        'FORBIDDEN',
      );
    }
    assert.equal(await statusInDb(property.id), 'AVAILABLE');
    for (const [user, status] of [
      ['leader', 'PENDING'],
      ['manager', 'SOLD'],
      ['admin', 'AVAILABLE'],
    ] as const) {
      assert.equal((await statusSet(property.id, status, user))['status'], status);
    }
  });

  it('EXPIRED, VERIFY_REQUIRED không đặt tay được; trạng thái sai/thiếu/trường lạ → 400', async () => {
    const property = await createProperty();
    for (const status of ['EXPIRED', 'VERIFY_REQUIRED', 'DRAFT', null]) {
      assert.deepEqual(await invalidFields(property.id, { status }), ['status'], String(status));
    }
    assert.deepEqual(await invalidFields(property.id, {}), ['status']);
    assert.deepEqual(await invalidFields(property.id, { status: 'SOLD', title: 'x' }), ['title']);
  });

  it('BĐS chờ xác minh không mở bán lại được (422), vẫn đặt SOLD/HIDDEN được', async () => {
    for (const waiting of ['VERIFY_REQUIRED', 'EXPIRED']) {
      const property = await createProperty();
      await db.query('UPDATE properties SET status = $1 WHERE id = $2', [waiting, property.id]);
      for (const status of ['AVAILABLE', 'PENDING']) {
        const error = await errorOf(await setStatus(property.id, { status }), 422);
        assert.equal(error.code, 'BUSINESS_RULE_VIOLATION', `${waiting} → ${status}`);
      }
      assert.equal(await statusInDb(property.id), waiting);
      assert.equal((await statusSet(property.id, 'SOLD'))['status'], 'SOLD');
      assert.equal((await statusSet(property.id, 'AVAILABLE'))['status'], 'AVAILABLE');
    }
  });

  it('expectedUpdatedAt cũ → 409, không đổi', async () => {
    const property = await createProperty();
    await statusSet(property.id, 'PENDING');
    const response = await setStatus(property.id, {
      status: 'SOLD',
      expectedUpdatedAt: property.updatedAt,
    });
    assert.equal((await errorOf(response, 409)).code, 'CONFLICT');
    assert.equal(await statusInDb(property.id), 'PENDING');
  });

  it('BĐS HIDDEN chỉ người sửa được mới thấy (chi tiết, danh sách); người khác nhận 404', async () => {
    const property = await createProperty();
    await statusSet(property.id, 'HIDDEN');
    for (const user of ['agent1', 'leader', 'manager', 'admin']) {
      assert.equal((await get(property.id, user)).status, 200, user);
      assert.equal((await listedIds(user)).includes(property.id), true, user);
    }
    for (const user of ['agent2', 'agent4']) {
      assert.equal((await get(property.id, user)).status, 404, user);
      assert.equal((await listedIds(user)).includes(property.id), false, user);
      assert.equal((await setStatus(property.id, { status: 'AVAILABLE' }, user)).status, 404, user);
      assert.equal(
        (await request('PATCH', `/properties/${property.id}`, { title: 'x' }, tokens[user])).status,
        404,
        user,
      );
    }
    await statusSet(property.id, 'AVAILABLE');
    assert.equal((await get(property.id, 'agent2')).status, 200, 'mở lại thì thấy');
  });

  it('không tồn tại, công ty khác → 404; id sai → 400; chưa đăng nhập → 401', async () => {
    assert.equal(
      (await setStatus('00000000-0000-4000-8000-000000000000', { status: 'SOLD' })).status,
      404,
    );
    await register('admin@b.vn');
    const other = await createProperty('_', await login('admin@b.vn'));
    assert.equal((await setStatus(other.id, { status: 'SOLD' }, 'admin')).status, 404);
    assert.equal((await setStatus('abc', { status: 'SOLD' })).status, 400);
    assert.equal(
      (await request('POST', `/properties/${other.id}/status`, { status: 'SOLD' })).status,
      401,
    );
  });
});
