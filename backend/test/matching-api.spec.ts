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

/**
 * Công ty A: admin, agent1, agent2 (AGENT), `propertyViewer` (role tuỳ chỉnh chỉ có `property.view` COMPANY).
 * Khách `wanted` của agent1 cần nhà ở phường riêng; BĐS `house` do admin tạo ở phường đó.
 */
describe('API matching (TASK-090)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let tenantA: string;
  let khanhHoa: string;
  let house: string;
  let wanted: string;
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
    const admin = await register('admin@a.vn');
    tenantA = admin.tenantId;
    userIds['admin'] = admin.userId;
    tokens['admin'] = await login('admin@a.vn');
    const hash = await hashPassword(PASSWORD);
    const viewerRole = await insertId(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'PROPERTY_VIEWER', 'Xem BĐS')`,
      [tenantA],
    );
    await db.query(
      `INSERT INTO role_permissions (role_id, permission_id, scope)
       SELECT $1, id, 'COMPANY' FROM permissions WHERE code = 'property.view'`,
      [viewerRole],
    );
    for (const [name, role] of [
      ['agent1', 'AGENT'],
      ['agent2', 'AGENT'],
      ['propertyViewer', 'PROPERTY_VIEWER'],
    ] as const) {
      userIds[name] = await insertId(
        `INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, $4)`,
        [tenantA, `${name}@a.vn`, hash, name],
      );
      await db.query(
        `INSERT INTO user_roles (user_id, role_id, tenant_id)
         SELECT $1, id, tenant_id FROM roles WHERE tenant_id = $2 AND code = $3`,
        [userIds[name], tenantA, role],
      );
      tokens[name] = await login(`${name}@a.vn`);
    }
    await register('admin@b.vn');
    tokens['otherAdmin'] = await login('admin@b.vn');

    const ward = await insertId(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, '22330', 'Vĩnh Hải')`,
      [khanhHoa],
    );
    house = await post('admin', '/properties', {
      title: 'Nhà phố Vĩnh Hải',
      propertyType: 'HOUSE',
      price: 5_000_000_000,
      area: 80,
      bedrooms: 3,
      provinceId: khanhHoa,
      wardId: ward,
    });
    wanted = await post('agent1', '/customers', { fullName: 'Chị Lan', phone: '+84901234567' });
    await post('agent1', `/customers/${wanted}/preferences`, {
      wardIds: [ward],
      budgetMax: 6_000_000_000,
      bedroomsMin: 3,
    });
  });

  after(async () => {
    await app.close();
  });

  async function insertId(sql: string, params: unknown[] = []): Promise<string> {
    const [row] = (await db.query(`${sql} RETURNING id`, params)) as { id: string }[];
    assert.ok(row);
    return row.id;
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

  async function post(user: string, path: string, payload: unknown): Promise<string> {
    const response = await request('POST', path, payload, tokens[user]);
    assert.equal(response.status, 201, await response.clone().text());
    return ((await response.json()) as { data: { id: string } }).data.id;
  }

  async function get(user: string | undefined, path: string): Promise<Response> {
    return request('GET', path, undefined, user ? tokens[user] : undefined);
  }

  async function dataOf<T>(response: Response): Promise<T> {
    assert.equal(response.status, 200, await response.clone().text());
    return ((await response.json()) as { data: T }).data;
  }

  interface Match {
    preferenceId: string;
    score: number;
    criteria: { criterion: string; weight: number; ratio: number }[];
    explanation: { summary: string; matched: string[]; partial: string[]; unmatched: string[] };
  }

  it('GET /properties/:id/matching-customers → khách phù hợp kèm điểm và lời giải thích', async () => {
    const matches = await dataOf<
      (Match & { customer: { id: string; fullName: string; status: string; agentId: string } })[]
    >(await get('admin', `/properties/${house}/matching-customers`));
    assert.equal(matches.length, 1);
    const [match] = matches;
    assert.deepEqual(match?.customer, {
      id: wanted,
      fullName: 'Chị Lan',
      status: 'NEW',
      agentId: userIds['agent1'],
    });
    assert.equal(match?.score, 100);
    assert.equal(
      match?.explanation.summary,
      '100% phù hợp vì đúng ngân sách, khu vực và số phòng ngủ.',
    );
    assert.equal(match?.criteria.length, 3);
    // agent2 không xem được khách của agent1; propertyViewer không có customer.view → rỗng.
    for (const user of ['agent2', 'propertyViewer']) {
      assert.deepEqual(
        await dataOf(await get(user, `/properties/${house}/matching-customers`)),
        [],
        user,
      );
    }
  });

  it('GET /customers/:id/matching-properties → BĐS phù hợp; ngoài phạm vi → 404; thiếu customer.view → 403', async () => {
    const matches = await dataOf<
      (Match & { property: { id: string; code: string; title: string; price: number } })[]
    >(await get('agent1', `/customers/${wanted}/matching-properties`));
    assert.deepEqual(
      matches.map((match) => [match.property.id, match.property.title, match.score]),
      [[house, 'Nhà phố Vĩnh Hải', 100]],
    );
    assert.match(matches[0]?.property.code ?? '', /^BDS-\d{6}$/);
    assert.equal((await get('agent2', `/customers/${wanted}/matching-properties`)).status, 404);
    assert.equal((await get('otherAdmin', `/customers/${wanted}/matching-properties`)).status, 404);
    assert.equal(
      (await get('propertyViewer', `/customers/${wanted}/matching-properties`)).status,
      403,
    );
    assert.equal((await get('admin', `/properties/${MISSING}/matching-customers`)).status, 404);
    assert.equal((await get(undefined, `/customers/${wanted}/matching-properties`)).status, 401);
    assert.equal((await get(undefined, `/properties/${house}/matching-customers`)).status, 401);
  });

  it('minScore, limit sai → 400; id sai → 400; minScore cao lọc bớt kết quả', async () => {
    for (const query of [
      'minScore=101',
      'minScore=-1',
      'minScore=abc',
      'limit=0',
      'limit=101',
      'limit=1.5',
    ]) {
      const response = await get('admin', `/properties/${house}/matching-customers?${query}`);
      assert.equal(response.status, 400, query);
      const field = query.split('=')[0] ?? '';
      const error = ((await response.json()) as { error: { details?: { field?: string }[] } })
        .error;
      assert.ok(
        error.details?.some((detail) => detail.field === field),
        `${query}: ${JSON.stringify(error.details)}`,
      );
    }
    assert.equal((await get('admin', '/properties/abc/matching-customers')).status, 400);
    assert.equal((await get('admin', '/customers/abc/matching-properties')).status, 400);

    const pricier = await post('admin', '/properties', {
      title: 'Nhà giá cao',
      propertyType: 'HOUSE',
      price: 6_600_000_000,
      area: 80,
      bedrooms: 3,
      provinceId: khanhHoa,
      wardId: (await dataOf<{ wardId: string }>(await get('admin', `/properties/${house}`))).wardId,
    });
    const ids = async (query: string): Promise<string[]> =>
      (
        await dataOf<{ property: { id: string } }[]>(
          await get('admin', `/customers/${wanted}/matching-properties${query}`),
        )
      ).map((match) => match.property.id);
    assert.deepEqual(await ids(''), [house, pricier]);
    assert.deepEqual(await ids('?minScore=90'), [house]);
    assert.deepEqual(await ids('?limit=1'), [house]);
  });
});
