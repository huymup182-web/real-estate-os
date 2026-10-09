import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { hashPassword } from '../src/auth/password.js';
import type { CustomerScopes } from '../src/customers/customers.service.js';
import { MatchingService } from '../src/matching/matching.service.js';
import type { PropertyScopes } from '../src/properties/properties.service.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';
const MISSING = '00000000-0000-4000-8000-000000000000';

const companyProperty: PropertyScopes = {
  view: 'COMPANY',
  edit: 'COMPANY',
  delete: undefined,
  contact: undefined,
  assign: undefined,
  documents: undefined,
  verify: undefined,
};
const companyCustomer: CustomerScopes = {
  view: 'COMPANY',
  edit: undefined,
  delete: undefined,
  assign: undefined,
};
const company = { property: companyProperty, customer: companyCustomer };

/**
 * Công ty A: admin, agent1, agent2 (AGENT). Mỗi test tạo BĐS ở một phường riêng; từ test thứ hai chỉ so
 * các khách do chính test đó tạo.
 */
describe('MatchingService.customersForProperty (TASK-087)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let matching: MatchingService;
  let tenantA: string;
  let khanhHoa: string;
  let wardSeq = 0;
  /** Khách do test hiện tại tạo; khách của test trước vẫn có thể đạt điểm nên chỉ so trong nhóm này. */
  let created: string[] = [];
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
    matching = app.get(MatchingService);

    khanhHoa = await insertId(`INSERT INTO provinces (code, name) VALUES ('56', 'Khánh Hòa')`);
    const admin = await register('admin@a.vn');
    tenantA = admin.tenantId;
    userIds['admin'] = admin.userId;
    tokens['admin'] = await login('admin@a.vn');
    const hash = await hashPassword(PASSWORD);
    for (const name of ['agent1', 'agent2']) {
      userIds[name] = await insertId(
        `INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, $4)`,
        [tenantA, `${name}@a.vn`, hash, name],
      );
      await db.query(
        `INSERT INTO user_roles (user_id, role_id, tenant_id)
         SELECT $1, id, tenant_id FROM roles WHERE tenant_id = $2 AND code = 'AGENT'`,
        [userIds[name], tenantA],
      );
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

  /** Phường mới cho mỗi test; bắt đầu nhóm khách mới của test. */
  async function newWard(): Promise<string> {
    wardSeq += 1;
    created = [];
    return insertId(`INSERT INTO wards (province_id, code, name) VALUES ($1, $2, $3)`, [
      khanhHoa,
      `9${String(wardSeq).padStart(4, '0')}`,
      `Phường ${wardSeq}`,
    ]);
  }

  async function createProperty(
    wardId: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    return post('admin', '/properties', {
      title: 'Nhà phố',
      propertyType: 'HOUSE',
      price: 5_000_000_000,
      area: 80,
      bedrooms: 3,
      roadAccess: 'CAR',
      legalStatus: 'PRIVATE_BOOK',
      provinceId: khanhHoa,
      wardId,
      ...extra,
    });
  }

  /** Khách của `user` với một nhu cầu ở phường `wardId`. */
  async function customerWanting(
    wardId: string,
    preference: Record<string, unknown>,
    user = 'agent1',
    name = 'Khách',
  ): Promise<string> {
    const customerId = await post(user, '/customers', { fullName: name, phone: '+84901234567' });
    created.push(customerId);
    await post(user, `/customers/${customerId}/preferences`, { wardIds: [wardId], ...preference });
    return customerId;
  }

  function actor(name: string): { userId: string; tenantId: string } {
    const userId = userIds[name];
    assert.ok(userId);
    return { userId, tenantId: tenantA };
  }

  const admin = (): { userId: string; tenantId: string } => actor('admin');

  function ownIds(matches: { customer: { id: string } }[]): string[] {
    return matches.map((match) => match.customer.id).filter((id) => created.includes(id));
  }

  it('xếp khách theo điểm, mỗi khách lấy nhu cầu khớp nhất, bỏ khách dưới 50 điểm', async () => {
    const ward = await newWard();
    const property = await createProperty(ward);
    const perfect = await customerWanting(ward, {
      budgetMin: 4_000_000_000,
      budgetMax: 6_000_000_000,
      bedroomsMin: 3,
    });
    const overBudget = await customerWanting(ward, { budgetMax: 4_500_000_000 });
    const twoNeeds = await customerWanting(ward, { budgetMax: 1_000_000_000 });
    await post('agent1', `/customers/${twoNeeds}/preferences`, {
      wardIds: [ward],
      propertyTypes: ['HOUSE'],
      bedroomsMin: 4,
    });
    await customerWanting(ward, { budgetMax: 2_000_000_000, propertyTypes: ['LAND'] });

    const matches = await matching.customersForProperty(admin(), property, company);
    assert.deepEqual(
      matches.map((match) => [match.customer.id, match.score]),
      [
        [perfect, 100],
        // Nhu cầu 2: khu vực 25 + loại 10 + phòng ngủ thiếu 1 → 5 trên 45 → 89%.
        [twoNeeds, 89],
        // Giá vượt 11,1% → 0,44 × 30 + 25 trên 55 → 70%.
        [overBudget, 70],
      ],
    );
    const top = matches[0];
    assert.equal(top?.customer.fullName, 'Khách');
    assert.equal(top?.customer.status, 'NEW');
    assert.equal(top?.customer.agentId, userIds['agent1']);
    assert.deepEqual(
      top?.criteria.map((item) => item.criterion),
      ['price', 'location', 'bedrooms'],
    );
    assert.equal(
      (await matching.customersForProperty(admin(), property, company, { minScore: 90, limit: 1 }))
        .length,
      1,
    );
  });

  it('bỏ nhu cầu đã tắt, đã xoá, khác loại giao dịch; bỏ khách WON/LOST và khách đã xoá', async () => {
    const ward = await newWard();
    const property = await createProperty(ward);
    const keep = await customerWanting(ward, { propertyTypes: ['HOUSE'] });
    await customerWanting(ward, { propertyTypes: ['HOUSE'], transactionType: 'RENT' });
    const inactive = await customerWanting(ward, { propertyTypes: ['HOUSE'] });
    await db.query(`UPDATE customer_preferences SET is_active = false WHERE customer_id = $1`, [
      inactive,
    ]);
    const removedPreference = await customerWanting(ward, { propertyTypes: ['HOUSE'] });
    await db.query(`UPDATE customer_preferences SET deleted_at = now() WHERE customer_id = $1`, [
      removedPreference,
    ]);
    for (const status of ['WON', 'LOST']) {
      const closed = await customerWanting(ward, { propertyTypes: ['HOUSE'] });
      await db.query(`UPDATE customers SET status = $2 WHERE id = $1`, [closed, status]);
    }
    const removed = await customerWanting(ward, { propertyTypes: ['HOUSE'] });
    await db.query(`UPDATE customers SET deleted_at = now() WHERE id = $1`, [removed]);

    const matches = await matching.customersForProperty(admin(), property, company);
    assert.deepEqual(ownIds(matches), [keep]);
  });

  it('chỉ xét khách trong phạm vi xem; BĐS ngoài phạm vi, không có hoặc công ty khác → 404', async () => {
    const ward = await newWard();
    const property = await createProperty(ward);
    const mine = await customerWanting(ward, { propertyTypes: ['HOUSE'] }, 'agent1');
    const others = await customerWanting(ward, { propertyTypes: ['HOUSE'] }, 'agent2');
    const agent1 = actor('agent1');

    const own = await matching.customersForProperty(agent1, property, {
      property: companyProperty,
      customer: { ...companyCustomer, view: 'OWN' },
    });
    assert.deepEqual(ownIds(own), [mine]);
    const all = await matching.customersForProperty(agent1, property, company);
    assert.deepEqual(ownIds(all).sort(), [mine, others].sort());
    assert.deepEqual(
      await matching.customersForProperty(agent1, property, {
        property: companyProperty,
        customer: { ...companyCustomer, view: undefined },
      }),
      [],
    );

    const otherTenantProperty = await post('otherAdmin', '/properties', {
      title: 'Nhà công ty B',
      propertyType: 'HOUSE',
      price: 1_000_000_000,
      area: 50,
      provinceId: khanhHoa,
      wardId: ward,
    });
    for (const [id, scopes] of [
      [MISSING, company],
      [otherTenantProperty, company],
      [property, { property: { ...companyProperty, view: undefined }, customer: companyCustomer }],
    ] as const) {
      await assert.rejects(matching.customersForProperty(agent1, id, scopes), (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'NOT_FOUND');
        return true;
      });
    }
  });
});
