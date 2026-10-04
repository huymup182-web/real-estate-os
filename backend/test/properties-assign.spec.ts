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
  agentId: string;
  ownerContactVisible: boolean;
  [key: string]: unknown;
}

interface ApiError {
  error: { code: string; details?: { field?: string }[] };
}

/**
 * Công ty A: admin; phòng D1 có `manager` (MANAGER), agent3 và team T1 (trưởng nhóm `leader`) gồm agent1,
 * agent2; phòng D2 có agent4. Mỗi test dùng BĐS mới do agent1 tạo (trừ khi ghi khác).
 */
describe('POST /api/v1/properties/:id/assign', () => {
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
      ['agent3', 'AGENT', d1],
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

  function assign(id: string, payload: unknown, user = 'leader'): Promise<Response> {
    return request('POST', `/properties/${id}/assign`, payload, tokens[user]);
  }

  async function assigned(id: string, agent: string, user = 'leader'): Promise<Detail> {
    const response = await assign(id, { agentId: userIds[agent] }, user);
    assert.equal(response.status, 200, `${user}: ${JSON.stringify(await response.clone().json())}`);
    return ((await response.json()) as { data: Detail }).data;
  }

  function get(id: string, user: string): Promise<Response> {
    return request('GET', `/properties/${id}`, undefined, tokens[user]);
  }

  async function errorOf(response: Response, status: number): Promise<ApiError['error']> {
    assert.equal(response.status, status);
    return ((await response.json()) as ApiError).error;
  }

  async function agentInDb(id: string): Promise<string> {
    const [row] = (await db.query('SELECT agent_id FROM properties WHERE id = $1', [id])) as {
      agent_id: string;
    }[];
    return row?.agent_id ?? '';
  }

  it('trưởng nhóm giao BĐS trong nhóm; người nhận sửa được, người cũ hết quyền sửa', async () => {
    const property = await createProperty();
    const data = await assigned(property.id, 'agent2');
    assert.equal(data.agentId, userIds['agent2']);
    assert.equal(data.updatedBy, userIds['leader']);
    const edit = (user: string): Promise<Response> =>
      request('PATCH', `/properties/${property.id}`, { title: `Sửa bởi ${user}` }, tokens[user]);
    assert.equal((await edit('agent2')).status, 200);
    // agent1 vẫn là người tạo nên còn trong phạm vi OWN (phase0/04-RBAC.md: phụ trách hoặc tạo).
    assert.equal((await edit('agent1')).status, 200);
    assert.equal((await get(property.id, 'agent2')).status, 200);
  });

  it('giao lại đúng người đang phụ trách → 200, không ghi gì', async () => {
    const property = await createProperty();
    const data = await assigned(property.id, 'agent1');
    assert.equal(data.updatedAt, property.updatedAt);
  });

  it('môi giới không có quyền phân BĐS → 403, kể cả BĐS của mình', async () => {
    const property = await createProperty();
    for (const user of ['agent1', 'agent2']) {
      const response = await assign(property.id, { agentId: userIds['agent2'] }, user);
      assert.equal((await errorOf(response, 403)).code, 'FORBIDDEN', user);
    }
    assert.equal(await agentInDb(property.id), userIds['agent1']);
  });

  it('phạm vi theo cấp: trưởng nhóm trong nhóm, trưởng phòng trong phòng, admin cả công ty', async () => {
    const property = await createProperty();
    assert.equal(
      (await errorOf(await assign(property.id, { agentId: userIds['agent3'] }), 403)).code,
      'FORBIDDEN',
      'trưởng nhóm không giao cho người ngoài nhóm',
    );
    await assigned(property.id, 'agent3', 'manager');
    assert.equal(
      (await errorOf(await assign(property.id, { agentId: userIds['agent2'] }), 403)).code,
      'FORBIDDEN',
      'BĐS của agent3 ngoài nhóm của trưởng nhóm',
    );
    assert.equal(
      (await errorOf(await assign(property.id, { agentId: userIds['agent4'] }, 'manager'), 403))
        .code,
      'FORBIDDEN',
      'trưởng phòng không giao sang phòng khác',
    );
    await assigned(property.id, 'agent4', 'admin');
    assert.equal(
      (await errorOf(await assign(property.id, { agentId: userIds['agent1'] }, 'manager'), 403))
        .code,
      'FORBIDDEN',
      'BĐS đã sang phòng D2',
    );
    assert.equal(await agentInDb(property.id), userIds['agent4']);
  });

  it('người nhận không tồn tại, đã khoá, đã xoá hoặc thuộc công ty khác → 400 agentId', async () => {
    const property = await createProperty();
    const [otherAdmin] = (await db.query(`SELECT id FROM users WHERE email = 'admin@b.vn'`)) as {
      id: string;
    }[];
    const hash = await hashPassword(PASSWORD);
    const locked = await insertUser('locked', hash, null, 'AGENT');
    await db.query(`UPDATE users SET status = 'LOCKED' WHERE id = $1`, [locked]);
    const removed = await insertUser('removed', hash, null, 'AGENT');
    await db.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [removed]);
    for (const agentId of [
      '00000000-0000-4000-8000-000000000000',
      otherAdmin?.id,
      locked,
      removed,
    ]) {
      const error = await errorOf(await assign(property.id, { agentId }, 'admin'), 400);
      assert.deepEqual(
        (error.details ?? []).map((detail) => detail.field),
        ['agentId'],
        String(agentId),
      );
    }
    assert.equal(await agentInDb(property.id), userIds['agent1']);
  });

  it('dữ liệu sai, thiếu, trường lạ → 400', async () => {
    const property = await createProperty();
    for (const payload of [{}, { agentId: 'abc' }, { agentId: null }]) {
      const error = await errorOf(await assign(property.id, payload), 400);
      assert.deepEqual(
        (error.details ?? []).map((detail) => detail.field),
        ['agentId'],
        JSON.stringify(payload),
      );
    }
    const error = await errorOf(
      await assign(property.id, { agentId: userIds['agent2'], status: 'SOLD' }),
      400,
    );
    assert.deepEqual(
      (error.details ?? []).map((detail) => detail.field),
      ['status'],
    );
  });

  it('expectedUpdatedAt cũ → 409, không đổi', async () => {
    const property = await createProperty();
    await request('PATCH', `/properties/${property.id}`, { title: 'Mới' }, tokens['agent1']);
    const response = await assign(property.id, {
      agentId: userIds['agent2'],
      expectedUpdatedAt: property.updatedAt,
    });
    assert.equal((await errorOf(response, 409)).code, 'CONFLICT');
    assert.equal(await agentInDb(property.id), userIds['agent1']);
  });

  it('không tồn tại, công ty khác → 404; id sai → 400; chưa đăng nhập → 401', async () => {
    const payload = { agentId: userIds['agent2'] };
    assert.equal((await assign('00000000-0000-4000-8000-000000000000', payload)).status, 404);
    const other = await createProperty('_', await login('admin@b.vn'));
    assert.equal((await assign(other.id, payload, 'admin')).status, 404);
    assert.equal((await assign('abc', payload)).status, 400);
    assert.equal((await request('POST', `/properties/${other.id}/assign`, payload)).status, 401);
  });
});
