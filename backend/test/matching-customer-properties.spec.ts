import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { hashPassword } from '../src/auth/password.js';
import type { CustomerScopes } from '../src/customers/customers.service.js';
import { MatchingService, type PropertyMatch } from '../src/matching/matching.service.js';
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
 * Công ty A: admin, agent1, agent2 (AGENT). BĐS do admin tạo; mỗi test dùng một phường riêng và chỉ so
 * các BĐS do chính test đó tạo.
 */
describe('MatchingService.propertiesForCustomer (TASK-088)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let matching: MatchingService;
  let tenantA: string;
  let khanhHoa: string;
  let wardSeq = 0;
  /** BĐS do test hiện tại tạo; BĐS của test trước vẫn có thể đạt điểm nên chỉ so trong nhóm này. */
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
    const id = await post('admin', '/properties', {
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
    created.push(id);
    return id;
  }

  /** Khách của `user` với một nhu cầu ở phường `wardId`. */
  async function customerWanting(
    wardId: string,
    preference: Record<string, unknown>,
    user = 'agent1',
    name = 'Khách',
  ): Promise<string> {
    const customerId = await post(user, '/customers', { fullName: name, phone: '+84901234567' });
    await post(user, `/customers/${customerId}/preferences`, { wardIds: [wardId], ...preference });
    return customerId;
  }

  function actor(name: string): { userId: string; tenantId: string } {
    const userId = userIds[name];
    assert.ok(userId);
    return { userId, tenantId: tenantA };
  }

  const admin = (): { userId: string; tenantId: string } => actor('admin');

  /** [id, điểm] của các BĐS do test hiện tại tạo, theo thứ tự kết quả. */
  function ownScores(matches: PropertyMatch[]): [string, number][] {
    return matches
      .filter((match) => created.includes(match.property.id))
      .map((match) => [match.property.id, match.score]);
  }

  it('xếp BĐS theo điểm, mỗi BĐS lấy nhu cầu khớp nhất (kể cả nhu cầu thuê), bỏ BĐS dưới 50 điểm', async () => {
    const ward = await newWard();
    const customer = await customerWanting(ward, {
      budgetMin: 4_000_000_000,
      budgetMax: 6_000_000_000,
      bedroomsMin: 3,
    });
    await post('agent1', `/customers/${customer}/preferences`, {
      transactionType: 'RENT',
      wardIds: [ward],
    });
    const perfect = await createProperty(ward);
    const pricey = await createProperty(ward, { price: 6_600_000_000 });
    const forRent = await createProperty(ward, { price: 20_000_000 });
    await db.query(`UPDATE properties SET transaction_type = 'RENT' WHERE id = $1`, [forRent]);
    await createProperty(ward, { price: 9_000_000_000, bedrooms: 1 });

    const matches = await matching.propertiesForCustomer(admin(), customer, company);
    assert.deepEqual(ownScores(matches), [
      // BĐS thuê khớp nhu cầu thuê (chỉ nêu khu vực) → 100; cùng điểm thì BĐS cập nhật sau trước.
      [forRent, 100],
      [perfect, 100],
      // Giá vượt 10% → 0,5 × 30 + 25 + 10 trên 65 → 77%.
      [pricey, 77],
    ]);
    const top = matches.find((match) => match.property.id === perfect);
    assert.equal(top?.property.title, 'Nhà phố');
    assert.match(top?.property.code ?? '', /^BDS-\d{6}$/);
    assert.equal(top?.property.price, 5_000_000_000);
    assert.deepEqual(
      top?.criteria.map((item) => item.criterion),
      ['price', 'location', 'bedrooms'],
    );
    assert.equal(
      (await matching.propertiesForCustomer(admin(), customer, company, { limit: 1 })).length,
      1,
    );
  });

  it('chỉ gợi ý BĐS đang AVAILABLE, chưa xoá, trong phạm vi xem; khách không có nhu cầu đang bật → rỗng', async () => {
    const ward = await newWard();
    const customer = await customerWanting(ward, { propertyTypes: ['HOUSE'] });
    const keep = await createProperty(ward);
    for (const status of ['PENDING', 'SOLD', 'HIDDEN']) {
      const other = await createProperty(ward);
      await db.query(`UPDATE properties SET status = $2 WHERE id = $1`, [other, status]);
    }
    const removed = await createProperty(ward);
    await db.query(`UPDATE properties SET deleted_at = now() WHERE id = $1`, [removed]);
    await post('otherAdmin', '/properties', {
      title: 'Nhà công ty B',
      propertyType: 'HOUSE',
      price: 1_000_000_000,
      area: 50,
      provinceId: khanhHoa,
      wardId: ward,
    });

    const all = await matching.propertiesForCustomer(admin(), customer, company);
    assert.deepEqual(
      ownScores(all).map(([id]) => id),
      [keep],
    );
    // agent1 chỉ xem được BĐS của mình (OWN), BĐS ở đây đều do admin tạo.
    assert.deepEqual(
      await matching.propertiesForCustomer(actor('agent1'), customer, {
        property: { ...companyProperty, view: 'OWN', edit: 'OWN' },
        customer: companyCustomer,
      }),
      [],
    );

    await db.query(`UPDATE customer_preferences SET is_active = false WHERE customer_id = $1`, [
      customer,
    ]);
    assert.deepEqual(await matching.propertiesForCustomer(admin(), customer, company), []);
  });

  it('khách không có, công ty khác hoặc ngoài phạm vi xem → 404', async () => {
    const ward = await newWard();
    const others = await customerWanting(ward, { propertyTypes: ['HOUSE'] }, 'agent2');
    const otherTenantCustomer = await post('otherAdmin', '/customers', {
      fullName: 'Khách công ty B',
      phone: '+84901234567',
    });
    for (const [id, scopes] of [
      [MISSING, company],
      [otherTenantCustomer, company],
      [others, { property: companyProperty, customer: { ...companyCustomer, view: 'OWN' } }],
    ] as const) {
      await assert.rejects(
        matching.propertiesForCustomer(actor('agent1'), id, scopes),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, 'NOT_FOUND');
          return true;
        },
      );
    }
  });
});
