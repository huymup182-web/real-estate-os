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
  ownerContactVisible: boolean;
  [key: string]: unknown;
}

/**
 * Công ty A: admin; phòng D1 có `manager` (MANAGER), team T1 (trưởng nhóm `leader`) gồm agent1, agent2;
 * phòng D2 có agent4. Mỗi test dùng BĐS mới do agent1 tạo và xoá lượt xem cũ trước khi chạy.
 */
describe('Lượt xem BĐS /api/v1/properties/:id/views', () => {
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

  interface Stats {
    totalViews: number;
    uniqueViewers: number;
    last7DaysViews: number;
    lastViewedAt: string | null;
  }

  function open(id: string, user: string): Promise<Response> {
    return request('GET', `/properties/${id}`, undefined, tokens[user]);
  }

  function statsResponse(id: string, user = 'agent1'): Promise<Response> {
    return request('GET', `/properties/${id}/views`, undefined, tokens[user]);
  }

  async function stats(id: string, user = 'agent1'): Promise<Stats> {
    const response = await statsResponse(id, user);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    return ((await response.json()) as { data: Stats }).data;
  }

  async function viewRows(id: string): Promise<{ user_id: string }[]> {
    return (await db.query('SELECT user_id FROM property_views WHERE property_id = $1', [id])) as {
      user_id: string;
    }[];
  }

  beforeEach(async () => {
    await db.query('DELETE FROM property_views');
  });

  it('mở chi tiết ghi lượt xem; cùng người mở lại trong 30 phút chỉ tính một lần', async () => {
    const property = await createProperty();
    assert.deepEqual(await stats(property.id), {
      totalViews: 0,
      uniqueViewers: 0,
      last7DaysViews: 0,
      lastViewedAt: null,
    });
    for (const user of ['agent2', 'agent2', 'agent4', 'agent2']) {
      assert.equal((await open(property.id, user)).status, 200);
    }
    assert.deepEqual(
      (await viewRows(property.id)).map((row) => row.user_id).sort(),
      [userIds['agent2'], userIds['agent4']].sort(),
    );
    // Lượt xem cũ hơn 30 phút: mở lại thì tính thêm.
    await db.query(
      `INSERT INTO property_views (tenant_id, property_id, user_id, viewed_at)
       VALUES ($1, $2, $3, now() - interval '31 minutes'), ($1, $2, $3, now() - interval '10 days')`,
      [tenantA, property.id, userIds['manager']],
    );
    assert.equal((await open(property.id, 'manager')).status, 200);
    const data = await stats(property.id);
    assert.equal(data.totalViews, 5);
    assert.equal(data.uniqueViewers, 3);
    assert.equal(data.last7DaysViews, 4);
    assert.ok(data.lastViewedAt && Date.now() - Date.parse(data.lastViewedAt) < 60_000);
  });

  it('sửa, đổi trạng thái, xem thống kê không ghi lượt xem; mở thất bại cũng không', async () => {
    const property = await createProperty();
    await request('PATCH', `/properties/${property.id}`, { title: 'Mới' }, tokens['agent1']);
    await request(
      'POST',
      `/properties/${property.id}/status`,
      { status: 'PENDING' },
      tokens['agent1'],
    );
    await stats(property.id);
    await request('GET', '/properties?pageSize=100', undefined, tokens['agent2']);
    await db.query(`UPDATE properties SET status = 'HIDDEN' WHERE id = $1`, [property.id]);
    assert.equal((await open(property.id, 'agent2')).status, 404);
    assert.deepEqual(await viewRows(property.id), []);
  });

  it('thống kê chỉ cho người sửa được BĐS: agent khác → 403; trưởng nhóm, trưởng phòng, admin xem được', async () => {
    const property = await createProperty();
    await open(property.id, 'agent2');
    for (const user of ['agent2', 'agent4']) {
      assert.equal((await statsResponse(property.id, user)).status, 403, user);
    }
    for (const user of ['agent1', 'leader', 'manager', 'admin']) {
      assert.equal((await stats(property.id, user)).totalViews, 1, user);
    }
  });

  it('không tồn tại, công ty khác → 404; id sai → 400; chưa đăng nhập → 401', async () => {
    assert.equal((await statsResponse('00000000-0000-4000-8000-000000000000')).status, 404);
    const other = await createProperty('_', await login('admin@b.vn'));
    assert.equal((await statsResponse(other.id, 'admin')).status, 404);
    assert.equal((await open(other.id, 'admin')).status, 404);
    assert.deepEqual(await viewRows(other.id), []);
    assert.equal((await statsResponse('abc')).status, 400);
    assert.equal((await request('GET', `/properties/${other.id}/views`)).status, 401);
  });
});
