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
  [key: string]: unknown;
}

interface ApiError {
  error: { code: string };
}

/**
 * Công ty A: admin; phòng D1 có `manager` (MANAGER), team T1 (trưởng nhóm `leader`) gồm agent1, agent2;
 * phòng D2 có agent4, `manager2` (MANAGER); `ownOnly` (role tuỳ chỉnh: property.view/create/delete phạm vi OWN).
 * Mỗi test xoá BĐS mới do agent1 tạo (trừ khi ghi khác).
 */
describe('DELETE /api/v1/properties/:id', () => {
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
      ['manager2', 'MANAGER', d2],
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
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'OWN_DELETER', 'Chỉ BĐS của mình')`,
      [tenantA],
    );
    await db.query(
      `INSERT INTO role_permissions (role_id, permission_id, scope)
       SELECT $1, id, 'OWN' FROM permissions
        WHERE code IN ('property.view', 'property.create', 'property.delete')`,
      [ownRole],
    );
    userIds['ownOnly'] = await insertUser('ownOnly', hash, null, 'OWN_DELETER');

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

  function remove(id: string, user: string): Promise<Response> {
    return request('DELETE', `/properties/${id}`, undefined, tokens[user]);
  }

  async function errorCode(response: Response, status: number): Promise<string> {
    assert.equal(response.status, status);
    return ((await response.json()) as ApiError).error.code;
  }

  async function rowOf(
    id: string,
  ): Promise<{ deleted_at: Date | null; updated_by: string | null }> {
    const [row] = (await db.query('SELECT deleted_at, updated_by FROM properties WHERE id = $1', [
      id,
    ])) as { deleted_at: Date | null; updated_by: string | null }[];
    assert.ok(row);
    return row;
  }

  it('trưởng phòng cùng phòng xoá được → 204; BĐS vẫn trong DB nhưng không đọc được nữa', async () => {
    const property = await createProperty();
    const response = await remove(property.id, 'manager');
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');

    const row = await rowOf(property.id);
    assert.ok(row.deleted_at);
    assert.equal(row.updated_by, userIds['manager']);
    assert.equal(
      (await request('GET', `/properties/${property.id}`, undefined, tokens['admin'])).status,
      404,
    );
    const list = (await (
      await request('GET', '/properties?pageSize=100', undefined, tokens['admin'])
    ).json()) as {
      data: { id: string }[];
    };
    assert.equal(
      list.data.some((item) => item.id === property.id),
      false,
    );
    assert.equal(
      await errorCode(await remove(property.id, 'manager'), 404),
      'NOT_FOUND',
      'xoá lần 2',
    );
  });

  it('admin xoá được BĐS của mọi người trong công ty', async () => {
    const property = await createProperty('agent4');
    assert.equal((await remove(property.id, 'admin')).status, 204);
  });

  it('không có quyền property.delete (AGENT, TEAM_LEADER) → 403, kể cả BĐS của chính mình', async () => {
    const property = await createProperty();
    for (const user of ['agent1', 'leader']) {
      assert.equal(await errorCode(await remove(property.id, user), 403), 'FORBIDDEN', user);
    }
    assert.equal((await rowOf(property.id)).deleted_at, null);
  });

  it('trưởng phòng khác phòng: xem được nhưng ngoài phạm vi xoá → 403', async () => {
    const property = await createProperty();
    assert.equal(await errorCode(await remove(property.id, 'manager2'), 403), 'FORBIDDEN');
    assert.equal((await rowOf(property.id)).deleted_at, null);
  });

  it('phạm vi xem OWN: BĐS người khác → 404; BĐS của mình xoá được', async () => {
    const others = await createProperty();
    assert.equal(await errorCode(await remove(others.id, 'ownOnly'), 404), 'NOT_FOUND');
    const mine = await createProperty('ownOnly');
    assert.equal((await remove(mine.id, 'ownOnly')).status, 204);
  });

  it('không tồn tại, công ty khác → 404; id sai → 400; chưa đăng nhập → 401', async () => {
    assert.equal((await remove('00000000-0000-4000-8000-000000000000', 'admin')).status, 404);
    await register('admin@b.vn');
    const other = await createProperty('_', await login('admin@b.vn'));
    assert.equal((await remove(other.id, 'admin')).status, 404);
    assert.equal((await rowOf(other.id)).deleted_at, null);
    assert.equal((await remove('abc', 'admin')).status, 400);
    assert.equal((await request('DELETE', `/properties/${other.id}`)).status, 401);
  });
});
