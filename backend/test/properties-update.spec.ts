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
 * Mỗi test sửa BĐS mới do agent1 tạo (trừ khi ghi khác).
 */
describe('PATCH /api/v1/properties/:id', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let tenantA: string;
  let khanhHoa: string;
  let nhaTrang: string;
  let vinhHai: string;
  let hcm: string;
  let benNghe: string;
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
    hcm = await insertId(`INSERT INTO provinces (code, name) VALUES ('79', 'TP. Hồ Chí Minh')`);
    nhaTrang = await insertId(
      `INSERT INTO districts (province_id, code, name) VALUES ($1, '568', 'Nha Trang')`,
      [khanhHoa],
    );
    vinhHai = await insertId(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, '22330', 'Vĩnh Hải')`,
      [khanhHoa],
    );
    benNghe = await insertId(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, '26740', 'Bến Nghé')`,
      [hcm],
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

  function patch(id: string, payload: unknown, user = 'agent1'): Promise<Response> {
    return request('PATCH', `/properties/${id}`, payload, tokens[user]);
  }

  async function patched(id: string, payload: unknown, user = 'agent1'): Promise<Detail> {
    const response = await patch(id, payload, user);
    assert.equal(response.status, 200, `${user}: ${JSON.stringify(await response.clone().json())}`);
    return ((await response.json()) as { data: Detail }).data;
  }

  async function errorOf(response: Response, status: number): Promise<ApiError['error']> {
    assert.equal(response.status, status);
    return ((await response.json()) as ApiError).error;
  }

  async function invalidFields(id: string, payload: unknown): Promise<string[]> {
    const error = await errorOf(await patch(id, payload), 400);
    assert.equal(error.code, 'VALIDATION_ERROR');
    return [...new Set((error.details ?? []).map((detail) => detail.field ?? ''))].sort();
  }

  async function titleInDb(id: string): Promise<string> {
    const [row] = (await db.query('SELECT title FROM properties WHERE id = $1', [id])) as {
      title: string;
    }[];
    return row?.title ?? '';
  }

  it('người phụ trách sửa được: chỉ đổi trường gửi lên, null xoá trường tuỳ chọn, ghi người sửa', async () => {
    const property = await createProperty();
    const data = await patched(property.id, {
      title: '  Nhà phố mới  ',
      price: 4_000_000_000,
      description: null,
      streetAddress: '',
      bedrooms: 3,
    });
    assert.equal(data['title'], 'Nhà phố mới');
    assert.equal(data['price'], 4_000_000_000);
    assert.equal(data['pricePerM2'], Math.round(4_000_000_000 / 70));
    assert.equal(data['description'], null);
    assert.equal(data['streetAddress'], null);
    assert.equal(data['bedrooms'], 3);
    assert.equal(data['area'], 70, 'không gửi thì giữ nguyên');
    assert.equal(data['commissionValue'], 1.5);
    assert.equal(data['code'], property['code']);
    assert.equal(data.updatedBy, userIds['agent1']);
    assert.ok(new Date(data.updatedAt) >= new Date(property.updatedAt));
    assert.equal(data.ownerContactVisible, true);
  });

  it('trưởng nhóm, trưởng phòng cùng phòng và admin sửa được BĐS của agent1', async () => {
    const property = await createProperty();
    for (const user of ['leader', 'manager', 'admin']) {
      const data = await patched(property.id, { title: `Sửa bởi ${user}` }, user);
      assert.equal(data['title'], `Sửa bởi ${user}`);
      assert.equal(data.updatedBy, userIds[user]);
    }
  });

  it('xem được nhưng ngoài phạm vi sửa → 403, không đổi gì', async () => {
    const property = await createProperty();
    for (const user of ['agent2', 'agent4']) {
      const error = await errorOf(await patch(property.id, { title: 'Không được' }, user), 403);
      assert.equal(error.code, 'FORBIDDEN', user);
    }
    assert.equal(await titleInDb(property.id), 'Nhà phố Vĩnh Hải');
  });

  it('phạm vi xem OWN: BĐS người khác → 404; BĐS của mình sửa được', async () => {
    const others = await createProperty();
    assert.equal(
      (await errorOf(await patch(others.id, { title: 'x' }, 'ownOnly'), 404)).code,
      'NOT_FOUND',
    );
    const mine = await createProperty('ownOnly');
    const data = await patched(mine.id, { title: 'Của tôi' }, 'ownOnly');
    assert.equal(data['title'], 'Của tôi');
    assert.equal(data.ownerContactVisible, false, 'không có quyền xem liên hệ chủ nhà');
  });

  it('expectedUpdatedAt: khớp → 200; đã bị người khác sửa → 409, không ghi đè', async () => {
    const property = await createProperty();
    const first = await patched(property.id, {
      title: 'Lần 1',
      expectedUpdatedAt: property.updatedAt,
    });
    const error = await errorOf(
      await patch(property.id, { title: 'Ghi đè', expectedUpdatedAt: property.updatedAt }),
      409,
    );
    assert.equal(error.code, 'CONFLICT');
    assert.equal(await titleInDb(property.id), 'Lần 1');
    await patched(property.id, { title: 'Lần 2', expectedUpdatedAt: first.updatedAt });
    assert.deepEqual(
      await invalidFields(property.id, { title: 'x', expectedUpdatedAt: 'hôm qua' }),
      ['expectedUpdatedAt'],
    );
  });

  it('body rỗng, trường bắt buộc gửi null, trường không sửa được → 400', async () => {
    const property = await createProperty();
    assert.deepEqual(await invalidFields(property.id, {}), ['']);
    assert.deepEqual(await invalidFields(property.id, { expectedUpdatedAt: property.updatedAt }), [
      '',
    ]);
    for (const field of ['title', 'propertyType', 'price', 'area', 'provinceId', 'wardId']) {
      assert.deepEqual(await invalidFields(property.id, { [field]: null }), [field], field);
    }
    for (const field of ['tenantId', 'code', 'status', 'agentId', 'ownerId', 'transactionType']) {
      assert.deepEqual(await invalidFields(property.id, { [field]: 'x' }), [field], field);
    }
    assert.deepEqual(await invalidFields(property.id, { price: -1, title: '<b>x</b>' }), [
      'price',
      'title',
    ]);
  });

  it('luật theo cặp kiểm trên giá trị sau khi gộp', async () => {
    const property = await createProperty();
    assert.deepEqual(await invalidFields(property.id, { latitude: null }), ['latitude']);
    assert.deepEqual(await invalidFields(property.id, { commissionType: null }), [
      'commissionValue',
    ]);
    assert.deepEqual(await invalidFields(property.id, { commissionValue: 150 }), [
      'commissionValue',
    ]);
    const cleared = await patched(property.id, {
      latitude: null,
      longitude: null,
      commissionType: null,
      commissionValue: null,
    });
    assert.deepEqual(
      [
        cleared['latitude'],
        cleared['longitude'],
        cleared['commissionType'],
        cleared['commissionValue'],
      ],
      [null, null, null, null],
    );
    const fixed = await patched(property.id, {
      commissionType: 'FIXED',
      commissionValue: 50_000_000,
    });
    assert.equal(fixed['commissionValue'], 50_000_000);
  });

  it('địa giới kiểm theo giá trị sau khi gộp', async () => {
    const property = await createProperty();
    assert.deepEqual(await invalidFields(property.id, { wardId: benNghe }), ['wardId']);
    assert.deepEqual(await invalidFields(property.id, { provinceId: hcm, wardId: benNghe }), [
      'districtId',
    ]);
    const moved = await patched(property.id, {
      provinceId: hcm,
      wardId: benNghe,
      districtId: null,
    });
    assert.deepEqual(
      [moved['provinceId'], moved['wardId'], moved['districtId']],
      [hcm, benNghe, null],
    );
  });

  it('không tồn tại, đã xoá mềm, công ty khác → 404; id sai → 400; chưa đăng nhập → 401', async () => {
    assert.equal((await patch('00000000-0000-4000-8000-000000000000', { title: 'x' })).status, 404);
    const removed = await createProperty();
    await db.query('UPDATE properties SET deleted_at = now() WHERE id = $1', [removed.id]);
    assert.equal((await patch(removed.id, { title: 'x' })).status, 404);

    await register('admin@b.vn');
    const other = await createProperty('_', await login('admin@b.vn'));
    assert.equal((await patch(other.id, { title: 'x' }, 'admin')).status, 404);
    assert.equal((await patch('abc', { title: 'x' })).status, 400);
    assert.equal((await request('PATCH', `/properties/${other.id}`, { title: 'x' })).status, 401);
  });
});
