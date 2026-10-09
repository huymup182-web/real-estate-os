import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { hashPassword } from '../src/auth/password.js';
import {
  MATCHED_PROPERTY_TITLE,
  MatchingNotifier,
} from '../src/notifications/matching-notifier.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

interface NotificationRow {
  user_id: string;
  title: string;
  body: string;
  data: {
    propertyId: string;
    matchCount: number;
    customers: { customerId: string; score: number }[];
  };
}

/**
 * Công ty A: admin (người tạo BĐS), agent1, agent2, agent3 (AGENT). Mỗi test dùng phường riêng và
 * khách luôn nêu ngân sách quanh giá nhà của test (mỗi test cách nhau 10 tỷ), nên khách của test khác
 * không đạt điểm với BĐS của test này.
 */
describe('Thông báo matching khi có BĐS mới (TASK-096)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let notifier: MatchingNotifier;
  let tenantA: string;
  let khanhHoa: string;
  let wardSeq = 0;
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
    notifier = app.get(MatchingNotifier);

    khanhHoa = await insertId(`INSERT INTO provinces (code, name) VALUES ('56', 'Khánh Hòa')`);
    const admin = await register('admin@a.vn');
    tenantA = admin.tenantId;
    userIds['admin'] = admin.userId;
    tokens['admin'] = await login('admin@a.vn');
    const hash = await hashPassword(PASSWORD);
    for (const name of ['agent1', 'agent2', 'agent3']) {
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
  });

  after(async () => {
    await app.close();
  });

  async function insertId(sql: string, params: unknown[] = []): Promise<string> {
    const rows = (await db.query(`${sql} RETURNING id`, params)) as { id: string }[];
    const [row] = rows;
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

  function user(name: string): string {
    const id = userIds[name];
    assert.ok(id, name);
    return id;
  }

  async function newWard(): Promise<string> {
    wardSeq += 1;
    return insertId(`INSERT INTO wards (province_id, code, name) VALUES ($1, $2, $3)`, [
      khanhHoa,
      `8${String(wardSeq).padStart(4, '0')}`,
      `Phường ${wardSeq}`,
    ]);
  }

  /** Giá nhà của test hiện tại: mỗi test cách nhau 10 tỷ để khách của test khác có điểm giá 0. */
  const price = (): number => wardSeq * 10_000_000_000;

  /** Khách của `owner` cần nhà ở `wardId`, ngân sách ±10% quanh giá nhà của test. */
  async function customerWanting(
    owner: string,
    name: string,
    wardId: string,
    preference: Record<string, unknown> = {},
  ): Promise<string> {
    const customerId = await post(owner, '/customers', { fullName: name, phone: '+84901234567' });
    await post(owner, `/customers/${customerId}/preferences`, {
      wardIds: [wardId],
      budgetMin: (price() / 10) * 9,
      budgetMax: (price() / 10) * 11,
      ...preference,
    });
    return customerId;
  }

  function createProperty(wardId: string, title = 'Nhà phố'): Promise<string> {
    return post('admin', '/properties', {
      title,
      propertyType: 'HOUSE',
      price: price(),
      area: 80,
      bedrooms: 3,
      provinceId: khanhHoa,
      wardId,
    });
  }

  async function notificationsFor(propertyId: string): Promise<NotificationRow[]> {
    return (await db.query(
      `SELECT user_id, title, body, data FROM notifications
        WHERE type = 'MATCHED_PROPERTY' AND data->>'propertyId' = $1 ORDER BY body`,
      [propertyId],
    )) as NotificationRow[];
  }

  async function waitForNotifications(
    propertyId: string,
    count: number,
  ): Promise<NotificationRow[]> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const rows = await notificationsFor(propertyId);
      if (rows.length >= count) {
        return rows;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return notificationsFor(propertyId);
  }

  it('tạo BĐS qua API thì mỗi môi giới nhận một thông báo về khách của mình phù hợp', async () => {
    const ward = await newWard();
    const an = await customerWanting('agent1', 'Anh An', ward, { bedroomsMin: 3 });
    const binh = await customerWanting('agent1', 'Chị Bình', ward, { bedroomsMin: 4 });
    await customerWanting('agent1', 'Cô Cúc', ward, {
      budgetMin: 1_000_000_000,
      budgetMax: 2_000_000_000,
    });
    const dung = await customerWanting('agent2', 'Chú Dũng', ward);
    const propertyId = await createProperty(ward, 'Nhà phố Phước Long');

    const rows = await waitForNotifications(propertyId, 2);
    assert.equal(rows.length, 2);
    const forAgent1 = rows.find((row) => row.user_id === user('agent1'));
    const forAgent2 = rows.find((row) => row.user_id === user('agent2'));
    assert.ok(forAgent1 && forAgent2);
    assert.equal(forAgent1.title, MATCHED_PROPERTY_TITLE);
    assert.match(
      forAgent1.body,
      /^BDS-\d{6} · Nhà phố Phước Long\. Phù hợp: Anh An \(100%\), Chị Bình \(\d+%\)$/,
    );
    assert.equal(forAgent1.data.matchCount, 2);
    assert.deepEqual(
      forAgent1.data.customers.map((c) => c.customerId),
      [an, binh],
    );
    assert.deepEqual(forAgent2.data.customers, [{ customerId: dung, score: 100 }]);
  });

  it('nhiều khách thì nêu 3 tên đầu và số khách còn lại', async () => {
    const ward = await newWard();
    for (const name of ['K1', 'K2', 'K3', 'K4', 'K5']) {
      await customerWanting('agent3', name, ward);
    }
    const propertyId = await createProperty(ward);
    const rows = await waitForNotifications(propertyId, 1);
    assert.equal(rows.length, 1);
    assert.match(
      rows[0]?.body ?? '',
      /Phù hợp: K\d \(100%\), K\d \(100%\), K\d \(100%\) và 2 khách khác$/,
    );
    assert.equal(rows[0]?.data.matchCount, 5);
  });

  it('không báo khách đã chốt/mất, môi giới bị khoá, BĐS không tồn tại', async () => {
    const ward = await newWard();
    const won = await customerWanting('agent1', 'Đã mua', ward);
    await db.query(`UPDATE customers SET status = 'WON' WHERE id = $1`, [won]);
    await customerWanting('agent3', 'Khách của người bị khoá', ward);
    await db.query(`UPDATE users SET status = 'INACTIVE' WHERE id = $1`, [user('agent3')]);
    try {
      const propertyId = await createProperty(ward);
      // Gọi thẳng để chờ xử lý xong (API chạy nền).
      assert.equal(
        await notifier.handle({ tenantId: tenantA, propertyId, createdBy: user('admin') }),
        0,
      );
      assert.deepEqual(await notificationsFor(propertyId), []);
    } finally {
      await db.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [user('agent3')]);
    }
    assert.equal(
      await notifier.handle({
        tenantId: tenantA,
        propertyId: '00000000-0000-4000-8000-000000000000',
        createdBy: user('admin'),
      }),
      0,
    );
  });
});
