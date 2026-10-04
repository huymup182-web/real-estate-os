import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { hashPassword } from '../src/auth/password.js';
import { PermissionService } from '../src/auth/permission.service.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

interface PropertyDetail {
  id: string;
  code: string;
  streetAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  ownerId: string | null;
  ownerContactVisible: boolean;
  owner: { id: string; fullName: string; phone: string; email: string | null } | null;
  [key: string]: unknown;
}

/**
 * Công ty A:
 * - Phòng D1: trưởng phòng `manager` (MANAGER); team T1 (trưởng nhóm `leader`) gồm `agent1`, `agent2`;
 *   `agent3` thuộc D1 nhưng không ở team nào; `collaborator` (COLLABORATOR) thuộc T1.
 * - Phòng D2: `agent4`, `manager2` (MANAGER).
 * - `ownOnly`: role tuỳ chỉnh chỉ có property.view phạm vi OWN.
 * BĐS `listing` do agent1 tạo, có chủ nhà.
 */
describe('GET /api/v1/properties/:id', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let tenantA: string;
  const tokens: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  let listing: PropertyDetail;
  let ownerId: string;
  let otherCompanyListing: string;
  let province: string;
  let ward: string;

  before(async () => {
    await useTestDatabase();
    app = await createApp();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    db = app.get(DataSource);

    province = await insertId(`INSERT INTO provinces (code, name) VALUES ('56', 'Khánh Hòa')`);
    ward = await insertId(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, '22330', 'Vĩnh Hải')`,
      [province],
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
    const people: [string, string, string][] = [
      ['manager', 'MANAGER', d1],
      ['leader', 'TEAM_LEADER', d1],
      ['agent1', 'AGENT', d1],
      ['agent2', 'AGENT', d1],
      ['agent3', 'AGENT', d1],
      ['collaborator', 'COLLABORATOR', d1],
      ['agent4', 'AGENT', d2],
      ['manager2', 'MANAGER', d2],
    ];
    for (const [name, role, department] of people) {
      userIds[name] = await insertUser(name, hash, department, role);
    }
    const t1 = await insertId(
      `INSERT INTO teams (tenant_id, department_id, name, leader_id) VALUES ($1, $2, 'T1', $3)`,
      [tenantA, d1, userIds['leader']],
    );
    for (const name of ['agent1', 'agent2', 'collaborator']) {
      await db.query(`INSERT INTO team_members (tenant_id, team_id, user_id) VALUES ($1, $2, $3)`, [
        tenantA,
        t1,
        userIds[name],
      ]);
    }

    const ownOnlyRole = await insertId(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'OWN_VIEWER', 'Chỉ xem BĐS của mình')`,
      [tenantA],
    );
    await db.query(
      `INSERT INTO role_permissions (role_id, permission_id, scope)
       SELECT $1, id, 'OWN' FROM permissions WHERE code IN ('property.view', 'property.create')`,
      [ownOnlyRole],
    );
    userIds['ownOnly'] = await insertUser('ownOnly', hash, null, 'OWN_VIEWER');

    for (const name of Object.keys(userIds)) {
      tokens[name] = await login(name === 'admin' ? 'admin@a.vn' : `${name}@a.vn`);
    }

    listing = await createProperty('agent1');
    ownerId = await insertId(
      `INSERT INTO owners (tenant_id, full_name, phone, email) VALUES ($1, 'Chủ nhà A', '+84901234567', 'chu@a.vn')`,
      [tenantA],
    );
    await db.query('UPDATE properties SET owner_id = $1 WHERE id = $2', [ownerId, listing.id]);

    await register('admin@b.vn');
    otherCompanyListing = (await createProperty('_', await login('admin@b.vn'))).id;
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
      (await response.json()) as {
        data: { user: { id: string }; company: { id: string } };
      }
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

  async function createProperty(user: string, token = tokens[user]): Promise<PropertyDetail> {
    const response = await request(
      'POST',
      '/properties',
      {
        title: 'Nhà phố Vĩnh Hải',
        propertyType: 'HOUSE',
        price: 3_500_000_000,
        area: 70,
        provinceId: province,
        wardId: ward,
        streetAddress: '12 Đường 2/4',
        latitude: 12.276543,
        longitude: 109.198765,
      },
      token,
    );
    assert.equal(response.status, 201);
    return ((await response.json()) as { data: PropertyDetail }).data;
  }

  function get(user: string, id = listing.id): Promise<Response> {
    return request('GET', `/properties/${id}`, undefined, tokens[user]);
  }

  async function detail(user: string, id = listing.id): Promise<PropertyDetail> {
    const response = await get(user, id);
    assert.equal(response.status, 200, user);
    return ((await response.json()) as { data: PropertyDetail }).data;
  }

  async function assertNotFound(response: Response): Promise<void> {
    assert.equal(response.status, 404);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'NOT_FOUND');
  }

  it('người phụ trách thấy đủ: địa chỉ, toạ độ, chủ nhà', async () => {
    const data = await detail('agent1');
    assert.equal(data.code, listing.code);
    assert.equal(data.ownerContactVisible, true);
    assert.equal(data.streetAddress, '12 Đường 2/4');
    assert.equal(data.latitude, 12.276543);
    assert.equal(data.longitude, 109.198765);
    assert.equal(data.ownerId, ownerId);
    assert.deepEqual(data.owner, {
      id: ownerId,
      fullName: 'Chủ nhà A',
      phone: '+84901234567',
      email: 'chu@a.vn',
    });
    assert.equal('tenantId' in data, false);
  });

  it('cấp quản lý trong phạm vi thấy liên hệ chủ nhà: trưởng nhóm, trưởng phòng cùng phòng, admin', async () => {
    for (const user of ['leader', 'manager', 'admin']) {
      const data = await detail(user);
      assert.equal(data.ownerContactVisible, true, user);
      assert.equal(data.owner?.phone, '+84901234567', user);
    }
  });

  it('người ngoài phạm vi liên hệ vẫn xem được BĐS nhưng bị ẩn địa chỉ và chủ nhà; toạ độ vẫn có', async () => {
    for (const user of ['agent2', 'agent3', 'agent4', 'collaborator', 'manager2']) {
      const data = await detail(user);
      assert.equal(data.id, listing.id, user);
      assert.equal(data['title'], 'Nhà phố Vĩnh Hải', user);
      assert.equal(data['price'], 3_500_000_000, user);
      assert.deepEqual(
        [
          data.ownerContactVisible,
          data.streetAddress,
          data.latitude,
          data.longitude,
          data.ownerId,
          data.owner,
        ],
        [false, null, 12.276543, 109.198765, null, null],
        user,
      );
    }
  });

  it('chủ nhà đã xoá mềm → owner null dù có quyền', async () => {
    await db.query('UPDATE owners SET deleted_at = now() WHERE id = $1', [ownerId]);
    try {
      const data = await detail('agent1');
      assert.equal(data.owner, null);
      assert.equal(data.ownerContactVisible, true);
    } finally {
      await db.query('UPDATE owners SET deleted_at = NULL WHERE id = $1', [ownerId]);
    }
  });

  it('property.view phạm vi OWN: BĐS người khác → 404, BĐS của mình → 200', async () => {
    await assertNotFound(await get('ownOnly'));
    const own = await createProperty('ownOnly');
    const data = await detail('ownOnly', own.id);
    assert.equal(data.id, own.id);
    assert.equal(data.ownerContactVisible, false, 'không có quyền view_owner_contact');
    assert.equal(data.streetAddress, null);
  });

  it('BĐS công ty khác, không tồn tại hoặc đã xoá mềm → 404', async () => {
    await assertNotFound(await get('admin', otherCompanyListing));
    await assertNotFound(await get('admin', '00000000-0000-4000-8000-000000000000'));
    const removed = await createProperty('agent1');
    await db.query('UPDATE properties SET deleted_at = now() WHERE id = $1', [removed.id]);
    await assertNotFound(await get('agent1', removed.id));
  });

  it('id sai định dạng → 400; chưa đăng nhập → 401; không có property.view → 403', async () => {
    const invalid = await request('GET', '/properties/abc', undefined, tokens['admin']);
    assert.equal(invalid.status, 400);
    assert.equal((await request('GET', `/properties/${listing.id}`)).status, 401);

    await db.query('DELETE FROM user_roles WHERE user_id = $1', [userIds['agent3']]);
    app.get(PermissionService).invalidate(userIds['agent3']);
    try {
      const noRole = await login('agent3@a.vn');
      const response = await request('GET', `/properties/${listing.id}`, undefined, noRole);
      assert.equal(response.status, 403);
    } finally {
      await db.query(
        `INSERT INTO user_roles (user_id, role_id, tenant_id)
         SELECT $1, id, tenant_id FROM roles WHERE tenant_id = $2 AND code = 'AGENT'`,
        [userIds['agent3'], tenantA],
      );
      app.get(PermissionService).invalidate(userIds['agent3']);
    }
  });
});
