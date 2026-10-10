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

interface Owner {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  notes: string | null;
}

interface Detail {
  id: string;
  updatedAt: string;
  updatedBy: string | null;
  ownerId: string | null;
  owner: Owner | null;
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
describe('PUT/DELETE /api/v1/properties/:id/owner', () => {
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

  const OWNER = {
    fullName: 'Chủ nhà A',
    phone: '+84901234567',
    email: 'chu@a.vn',
    notes: 'Gọi buổi tối',
  };

  function putOwner(id: string, payload: unknown, user = 'agent1'): Promise<Response> {
    return request('PUT', `/properties/${id}/owner`, payload, tokens[user]);
  }

  async function ownerSet(id: string, payload: unknown, user = 'agent1'): Promise<Detail> {
    const response = await putOwner(id, payload, user);
    assert.equal(response.status, 200, `${user}: ${JSON.stringify(await response.clone().json())}`);
    return ((await response.json()) as { data: Detail }).data;
  }

  function deleteOwner(id: string, user = 'agent1'): Promise<Response> {
    return request('DELETE', `/properties/${id}/owner`, undefined, tokens[user]);
  }

  function get(id: string, user: string): Promise<Response> {
    return request('GET', `/properties/${id}`, undefined, tokens[user]);
  }

  async function errorOf(response: Response, status: number): Promise<ApiError['error']> {
    assert.equal(response.status, status);
    return ((await response.json()) as ApiError).error;
  }

  async function invalidFields(id: string, payload: unknown): Promise<string[]> {
    const error = await errorOf(await putOwner(id, payload), 400);
    assert.equal(error.code, 'VALIDATION_ERROR');
    return [...new Set((error.details ?? []).map((detail) => detail.field ?? ''))].sort();
  }

  async function ownerRow(id: string): Promise<{
    full_name: string;
    deleted_at: Date | null;
    created_by: string;
    updated_by: string;
  }> {
    const [row] = (await db.query(
      'SELECT full_name, deleted_at, created_by, updated_by FROM owners WHERE id = $1',
      [id],
    )) as { full_name: string; deleted_at: Date | null; created_by: string; updated_by: string }[];
    assert.ok(row);
    return row;
  }

  async function ownerIdInDb(id: string): Promise<string | null> {
    const [row] = (await db.query('SELECT owner_id FROM properties WHERE id = $1', [id])) as {
      owner_id: string | null;
    }[];
    return row?.owner_id ?? null;
  }

  it('người phụ trách nhập chủ nhà; chi tiết trả đủ, ghi người tạo/sửa', async () => {
    const property = await createProperty();
    assert.equal(property.ownerId, null);
    const data = await ownerSet(property.id, OWNER);
    assert.ok(data.ownerId);
    assert.deepEqual(data.owner, { id: data.ownerId, ...OWNER });
    assert.equal(data.updatedBy, userIds['agent1']);
    const row = await ownerRow(data.ownerId);
    assert.equal(row.created_by, userIds['agent1']);
    assert.equal(row.updated_by, userIds['agent1']);
    assert.deepEqual(
      ((await (await get(property.id, 'agent1')).json()) as { data: Detail }).data.owner,
      data.owner,
    );
  });

  it('nhập lại thì sửa đúng bản ghi chủ nhà đó; trường tuỳ chọn bỏ trống thì xoá', async () => {
    const property = await createProperty();
    const first = await ownerSet(property.id, OWNER);
    const second = await ownerSet(
      property.id,
      { fullName: '  Chủ nhà B  ', phone: '+84987654321', email: '', notes: null },
      'leader',
    );
    assert.equal(second.ownerId, first.ownerId);
    assert.deepEqual(second.owner, {
      id: first.ownerId,
      fullName: 'Chủ nhà B',
      phone: '+84987654321',
      email: null,
      notes: null,
    });
    assert.equal((await ownerRow(first.ownerId ?? '')).updated_by, userIds['leader']);
  });

  it('mỗi BĐS có chủ nhà riêng: cùng SĐT không gộp, sửa căn này không đổi căn kia', async () => {
    const one = await ownerSet((await createProperty()).id, OWNER);
    const twoProperty = await createProperty();
    const two = await ownerSet(twoProperty.id, OWNER);
    assert.notEqual(one.ownerId, two.ownerId);
    await ownerSet(twoProperty.id, { ...OWNER, fullName: 'Tên mới' });
    assert.equal((await ownerRow(one.ownerId ?? '')).full_name, 'Chủ nhà A');
  });

  it('thiếu quyền sửa hoặc quyền xem liên hệ chủ nhà → 403, không đổi gì', async () => {
    const property = await createProperty();
    for (const user of ['agent2', 'agent4']) {
      assert.equal(
        (await errorOf(await putOwner(property.id, OWNER, user), 403)).code,
        'FORBIDDEN',
      );
      assert.equal((await errorOf(await deleteOwner(property.id, user), 403)).code, 'FORBIDDEN');
    }
    const own = await createProperty('ownOnly');
    assert.equal(
      (await errorOf(await putOwner(own.id, OWNER, 'ownOnly'), 403)).code,
      'FORBIDDEN',
      'sửa được nhưng không xem được liên hệ',
    );
    assert.equal((await errorOf(await deleteOwner(own.id, 'ownOnly'), 403)).code, 'FORBIDDEN');
    assert.equal(await ownerIdInDb(property.id), null);
    assert.equal(await ownerIdInDb(own.id), null);
    for (const user of ['manager', 'admin']) {
      assert.equal((await ownerSet(property.id, OWNER, user)).owner?.fullName, OWNER.fullName);
    }
  });

  it('dữ liệu sai, thiếu, trường lạ → 400', async () => {
    const property = await createProperty();
    assert.deepEqual(await invalidFields(property.id, {}), ['fullName', 'phone']);
    assert.deepEqual(await invalidFields(property.id, { ...OWNER, fullName: '   ' }), ['fullName']);
    assert.deepEqual(await invalidFields(property.id, { ...OWNER, fullName: '<b>x</b>' }), [
      'fullName',
    ]);
    for (const phone of ['0901234567', '+84 901', '+8490123456789012', null]) {
      assert.deepEqual(
        await invalidFields(property.id, { ...OWNER, phone }),
        ['phone'],
        String(phone),
      );
    }
    assert.deepEqual(await invalidFields(property.id, { ...OWNER, email: 'abc' }), ['email']);
    assert.deepEqual(await invalidFields(property.id, { ...OWNER, notes: 'x'.repeat(2001) }), [
      'notes',
    ]);
    assert.deepEqual(await invalidFields(property.id, { ...OWNER, ownerId: property.id }), [
      'ownerId',
    ]);
    assert.equal(await ownerIdInDb(property.id), null);
  });

  it('gỡ chủ nhà → 204, BĐS không còn chủ nhà, bản ghi chủ nhà xoá mềm; gỡ lần nữa vẫn 204', async () => {
    const property = await createProperty();
    const data = await ownerSet(property.id, OWNER);
    assert.equal((await deleteOwner(property.id)).status, 204);
    const after = ((await (await get(property.id, 'agent1')).json()) as { data: Detail }).data;
    assert.equal(after.ownerId, null);
    assert.equal(after.owner, null);
    assert.equal(after.updatedBy, userIds['agent1']);
    assert.ok((await ownerRow(data.ownerId ?? '')).deleted_at);
    assert.equal((await deleteOwner(property.id)).status, 204);
    const again = await ownerSet(property.id, OWNER);
    assert.notEqual(again.ownerId, data.ownerId, 'nhập lại tạo bản ghi mới');
  });

  it('gỡ chủ nhà vẫn giữ bản ghi nếu BĐS khác còn dùng', async () => {
    const one = await createProperty();
    const data = await ownerSet(one.id, OWNER);
    const two = await createProperty();
    await db.query('UPDATE properties SET owner_id = $1 WHERE id = $2', [data.ownerId, two.id]);
    assert.equal((await deleteOwner(one.id)).status, 204);
    assert.equal((await ownerRow(data.ownerId ?? '')).deleted_at, null);
  });

  it('expectedUpdatedAt cũ → 409, không đổi', async () => {
    const property = await createProperty();
    const response = await putOwner(property.id, {
      ...OWNER,
      expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
    });
    assert.equal((await errorOf(response, 409)).code, 'CONFLICT');
    assert.equal(await ownerIdInDb(property.id), null);
    const data = await ownerSet(property.id, { ...OWNER, expectedUpdatedAt: property.updatedAt });
    assert.ok(data.ownerId);
  });

  it('BĐS ẩn với người không sửa được, không tồn tại, công ty khác → 404; id sai → 400; chưa đăng nhập → 401', async () => {
    const hidden = await createProperty();
    await db.query(`UPDATE properties SET status = 'HIDDEN' WHERE id = $1`, [hidden.id]);
    assert.equal((await putOwner(hidden.id, OWNER, 'agent2')).status, 404);
    assert.equal((await deleteOwner(hidden.id, 'agent2')).status, 404);
    const missing = '00000000-0000-4000-8000-000000000000';
    assert.equal((await putOwner(missing, OWNER)).status, 404);
    assert.equal((await deleteOwner(missing)).status, 404);
    await register('admin@b.vn');
    const other = await createProperty('_', await login('admin@b.vn'));
    assert.equal((await putOwner(other.id, OWNER, 'admin')).status, 404);
    assert.equal((await deleteOwner(other.id, 'admin')).status, 404);
    assert.equal((await putOwner('abc', OWNER)).status, 400);
    assert.equal((await request('PUT', `/properties/${other.id}/owner`, OWNER)).status, 401);
    assert.equal((await request('DELETE', `/properties/${other.id}/owner`)).status, 401);
  });
});
