import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';

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
  isFavorite: boolean;
  ownerContactVisible: boolean;
  [key: string]: unknown;
}

/**
 * Công ty A: admin; phòng D1 có `manager` (MANAGER), team T1 (trưởng nhóm `leader`) gồm agent1, agent2;
 * phòng D2 có agent4. Mỗi test dùng BĐS mới do agent1 tạo và xoá yêu thích cũ trước khi chạy.
 */
describe('BĐS yêu thích /api/v1/properties/favorites', () => {
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
    for (const name of Object.keys(userIds)) {
      tokens[name] = await login(`${name}@a.vn`);
    }
    await register('admin@b.vn');
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

  function favorite(method: 'PUT' | 'DELETE', id: string, user = 'agent2'): Promise<Response> {
    return request(method, `/properties/${id}/favorite`, undefined, tokens[user]);
  }

  async function favorites(
    user = 'agent2',
    query = 'pageSize=100',
  ): Promise<{
    ids: string[];
    meta: { total: number };
    data: Detail[];
  }> {
    const response = await request(
      'GET',
      `/properties/favorites?${query}`,
      undefined,
      tokens[user],
    );
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const body = (await response.json()) as { data: Detail[]; meta: { total: number } };
    return { ids: body.data.map((item) => item.id), meta: body.meta, data: body.data };
  }

  async function detail(id: string, user = 'agent2'): Promise<Detail> {
    const response = await request('GET', `/properties/${id}`, undefined, tokens[user]);
    assert.equal(response.status, 200);
    return ((await response.json()) as { data: Detail }).data;
  }

  beforeEach(async () => {
    await db.query('DELETE FROM property_favorites');
  });

  it('lưu yêu thích → 204; lưu lại không đổi gì; danh sách mới lưu trước, có phân trang', async () => {
    const first = await createProperty();
    const second = await createProperty();
    assert.equal((await favorite('PUT', first.id)).status, 204);
    assert.equal((await favorite('PUT', second.id)).status, 204);
    assert.equal((await favorite('PUT', first.id)).status, 204, 'lưu lại');
    const [count] = (await db.query('SELECT COUNT(*)::int AS n FROM property_favorites')) as {
      n: number;
    }[];
    assert.equal(count?.n, 2);
    const all = await favorites();
    assert.deepEqual(all.ids, [second.id, first.id]);
    assert.equal(all.meta.total, 2);
    assert.ok(all.data.every((item) => item.isFavorite));
    const page = await favorites('agent2', 'page=2&pageSize=1');
    assert.deepEqual(page.ids, [first.id]);
    assert.equal(page.meta.total, 2);
  });

  it('yêu thích là của riêng từng user; chi tiết và danh sách BĐS có isFavorite', async () => {
    const property = await createProperty();
    await favorite('PUT', property.id, 'agent2');
    assert.deepEqual((await favorites('agent4')).ids, []);
    assert.equal((await detail(property.id, 'agent2')).isFavorite, true);
    assert.equal((await detail(property.id, 'agent4')).isFavorite, false);
    const response = await request('GET', '/properties?pageSize=100', undefined, tokens['agent2']);
    const items = ((await response.json()) as { data: Detail[] }).data;
    assert.equal(items.find((item) => item.id === property.id)?.isFavorite, true);
  });

  it('bỏ yêu thích → 204; bỏ khi chưa lưu vẫn 204', async () => {
    const property = await createProperty();
    await favorite('PUT', property.id);
    assert.equal((await favorite('DELETE', property.id)).status, 204);
    assert.deepEqual((await favorites()).ids, []);
    assert.equal((await favorite('DELETE', property.id)).status, 204);
    assert.equal((await detail(property.id)).isFavorite, false);
  });

  it('BĐS bị ẩn, đã xoá thì không hiện trong danh sách nhưng vẫn bỏ được; mở lại thì hiện lại', async () => {
    const hidden = await createProperty();
    const removed = await createProperty();
    await favorite('PUT', hidden.id);
    await favorite('PUT', removed.id);
    await db.query(`UPDATE properties SET status = 'HIDDEN' WHERE id = $1`, [hidden.id]);
    assert.equal(
      (await request('DELETE', `/properties/${removed.id}`, undefined, tokens['admin'])).status,
      204,
    );
    const list = await favorites();
    assert.deepEqual(list.ids, []);
    assert.equal(list.meta.total, 0);
    await db.query(`UPDATE properties SET status = 'AVAILABLE' WHERE id = $1`, [hidden.id]);
    assert.deepEqual((await favorites()).ids, [hidden.id]);
    await db.query(`UPDATE properties SET status = 'HIDDEN' WHERE id = $1`, [hidden.id]);
    assert.equal((await favorite('DELETE', hidden.id)).status, 204);
    await db.query(`UPDATE properties SET status = 'AVAILABLE' WHERE id = $1`, [hidden.id]);
    assert.deepEqual((await favorites()).ids, []);
  });

  it('không xem được BĐS, không tồn tại, công ty khác → 404 khi lưu; id sai → 400; chưa đăng nhập → 401', async () => {
    const hidden = await createProperty();
    await db.query(`UPDATE properties SET status = 'HIDDEN' WHERE id = $1`, [hidden.id]);
    assert.equal((await favorite('PUT', hidden.id)).status, 404);
    assert.equal((await favorite('PUT', '00000000-0000-4000-8000-000000000000')).status, 404);
    const other = await createProperty('_', await login('admin@b.vn'));
    assert.equal((await favorite('PUT', other.id)).status, 404);
    assert.equal((await favorite('PUT', 'abc')).status, 400);
    assert.equal((await favorite('DELETE', 'abc')).status, 400);
    assert.equal((await request('PUT', `/properties/${other.id}/favorite`)).status, 401);
    assert.equal((await request('GET', '/properties/favorites')).status, 401);
    const [count] = (await db.query('SELECT COUNT(*)::int AS n FROM property_favorites')) as {
      n: number;
    }[];
    assert.equal(count?.n, 0);
  });
});
