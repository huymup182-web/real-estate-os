import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { hashPassword } from '../src/auth/password.js';
import {
  NEW_PROPERTY_TITLE,
  NewPropertyNotifier,
} from '../src/notifications/new-property-notifier.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

interface NotificationRow {
  user_id: string;
  title: string;
  body: string;
  data: { propertyId: string; savedSearchIds: string[] };
}

/**
 * Công ty A: admin (người tạo BĐS), agent1, agent2 (AGENT), norole (không role, không xem được BĐS).
 * Công ty B: adminB. Tìm kiếm đã lưu chèn thẳng DB; mỗi test dùng tiêu đề BĐS riêng.
 */
describe('Thông báo BĐS mới cho tìm kiếm đã lưu (TASK-095)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let notifier: NewPropertyNotifier;
  let tenantA: string;
  let tenantB: string;
  let khanhHoa: string;
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
    notifier = app.get(NewPropertyNotifier);

    khanhHoa = await insertId(`INSERT INTO provinces (code, name) VALUES ('56', 'Khánh Hòa')`);
    vinhHai = await insertId(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, '22330', 'Vĩnh Hải')`,
      [khanhHoa],
    );

    const admin = await register('admin@a.vn');
    tenantA = admin.tenantId;
    userIds['admin'] = admin.userId;
    const adminB = await register('admin@b.vn');
    tenantB = adminB.tenantId;
    userIds['adminB'] = adminB.userId;
    const hash = await hashPassword(PASSWORD);
    for (const [name, role] of [
      ['agent1', 'AGENT'],
      ['agent2', 'AGENT'],
      ['norole', null],
    ] as const) {
      userIds[name] = await insertUser(name, hash, role);
    }
    tokens['admin'] = await login('admin@a.vn');
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

  async function insertUser(name: string, hash: string, roleCode: string | null): Promise<string> {
    const id = await insertId(
      `INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, $4)`,
      [tenantA, `${name}@a.vn`, hash, name],
    );
    if (roleCode) {
      await db.query(
        `INSERT INTO user_roles (user_id, role_id, tenant_id)
         SELECT $1, id, tenant_id FROM roles WHERE tenant_id = $2 AND code = $3`,
        [id, tenantA, roleCode],
      );
    }
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

  function user(name: string): string {
    const id = userIds[name];
    assert.ok(id, name);
    return id;
  }

  /** Tìm kiếm đã lưu theo từ khoá `q` riêng của test, kèm bộ lọc thêm. */
  function saveSearch(
    owner: string,
    name: string,
    filters: Record<string, unknown>,
    options: { notify?: boolean; deleted?: boolean; tenantId?: string } = {},
  ): Promise<string> {
    return insertId(
      `INSERT INTO saved_searches (tenant_id, user_id, name, filters, notify, deleted_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [
        options.tenantId ?? tenantA,
        user(owner),
        name,
        JSON.stringify(filters),
        options.notify ?? true,
        options.deleted ? new Date() : null,
      ],
    );
  }

  async function createProperty(title: string, price = 3_500_000_000): Promise<string> {
    const response = await request(
      'POST',
      '/properties',
      { title, propertyType: 'HOUSE', price, area: 70, provinceId: khanhHoa, wardId: vinhHai },
      tokens['admin'],
    );
    assert.equal(response.status, 201);
    return ((await response.json()) as { data: { id: string } }).data.id;
  }

  async function notificationsFor(propertyId: string): Promise<NotificationRow[]> {
    return (await db.query(
      `SELECT user_id, title, body, data FROM notifications
        WHERE type = 'NEW_PROPERTY' AND data->>'propertyId' = $1 ORDER BY user_id`,
      [propertyId],
    )) as NotificationRow[];
  }

  async function waitForNotifications(propertyId: string): Promise<NotificationRow[]> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const rows = await notificationsFor(propertyId);
      if (rows.length > 0) {
        return rows;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return [];
  }

  it('tạo BĐS qua API thì người có tìm kiếm khớp nhận thông báo, tìm kiếm được ghi last_notified_at', async () => {
    const searchId = await saveSearch('agent1', 'Nhà Vĩnh Hải', {
      q: 'sansang',
      provinceId: khanhHoa,
      priceMax: 5_000_000_000,
    });
    const propertyId = await createProperty('Nhà sansang gần biển');

    const rows = await waitForNotifications(propertyId);
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.equal(row?.user_id, user('agent1'));
    assert.equal(row.title, NEW_PROPERTY_TITLE);
    assert.match(row.body, /^BDS-\d{6} · Nhà sansang gần biển\. Khớp: "Nhà Vĩnh Hải"$/);
    assert.deepEqual(row.data, { propertyId, savedSearchIds: [searchId] });

    const [saved] = (await db.query(`SELECT last_notified_at FROM saved_searches WHERE id = $1`, [
      searchId,
    ])) as { last_notified_at: Date | null }[];
    assert.ok(saved?.last_notified_at);
  });

  it('một thông báo mỗi người dù khớp nhiều tìm kiếm; bỏ qua tìm kiếm không khớp, tắt báo, đã xoá', async () => {
    const cheap = await saveSearch('agent1', 'Rẻ', { q: 'nhieukhop', priceMax: 4_000_000_000 });
    const house = await saveSearch('agent1', 'Nhà phố', {
      q: 'nhieukhop',
      propertyType: ['HOUSE'],
    });
    const land = await saveSearch('agent1', 'Đất', { q: 'nhieukhop', propertyType: ['LAND'] });
    await saveSearch('agent2', 'Tắt báo', { q: 'nhieukhop' }, { notify: false });
    await saveSearch('agent2', 'Đã xoá', { q: 'nhieukhop' }, { deleted: true });
    const propertyId = await createProperty('Nhà nhieukhop');
    await waitForNotifications(propertyId);

    const rows = await notificationsFor(propertyId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.user_id, user('agent1'));
    assert.deepEqual(rows[0]?.data.savedSearchIds.sort(), [cheap, house].sort());
    assert.ok(!rows[0]?.data.savedSearchIds.includes(land));
    assert.match(rows[0]?.body ?? '', /Khớp: "Rẻ", "Nhà phố"$/);
  });

  it('không báo người tạo, người không có quyền xem BĐS, người công ty khác', async () => {
    const filters = { q: 'khongbao' };
    await saveSearch('admin', 'Của người tạo', filters);
    await saveSearch('norole', 'Không quyền', filters);
    await saveSearch('adminB', 'Công ty B', filters, { tenantId: tenantB });
    const propertyId = await createProperty('Nhà khongbao');

    // Gọi thẳng để chờ xử lý xong (API chạy nền).
    const notified = await notifier.handle({
      tenantId: tenantA,
      propertyId,
      createdBy: user('admin'),
    });
    assert.equal(notified, 0);
    assert.deepEqual(await notificationsFor(propertyId), []);
  });

  it('bộ lọc đã lưu không còn hợp lệ thì bỏ qua tìm kiếm đó, vẫn báo tìm kiếm khác', async () => {
    await saveSearch('agent2', 'Hỏng', { q: 'bolochong', khongTonTai: 1 });
    const good = await saveSearch('agent2', 'Tốt', { q: 'bolochong' });
    const propertyId = await createProperty('Nhà bolochong');

    const rows = await waitForNotifications(propertyId);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]?.data.savedSearchIds, [good]);
  });

  it('BĐS không tồn tại hoặc đã xoá thì không báo gì', async () => {
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
