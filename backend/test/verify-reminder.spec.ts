import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { hashPassword } from '../src/auth/password.js';
import {
  VERIFY_REQUIRED_TITLE,
  VerifyReminderNotifier,
} from '../src/notifications/verify-reminder-notifier.js';
import { PropertiesService } from '../src/properties/properties.service.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

interface NotificationRow {
  user_id: string;
  title: string;
  body: string;
  data: { count: number; propertyIds: string[] };
}

/** Công ty A: admin, agent1, agent2 (AGENT). BĐS do môi giới tạo nên họ là người phụ trách. */
describe('Nhắc xác minh BĐS (TASK-098)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let properties: PropertiesService;
  let tenantA: string;
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
    properties = app.get(PropertiesService);

    khanhHoa = await insertId(`INSERT INTO provinces (code, name) VALUES ('56', 'Khánh Hòa')`);
    vinhHai = await insertId(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, '22330', 'Vĩnh Hải')`,
      [khanhHoa],
    );
    const response = await request('POST', '/auth/register', {
      companyName: 'Công ty A',
      fullName: 'Quản trị',
      email: 'admin@a.vn',
      password: PASSWORD,
    });
    assert.equal(response.status, 201);
    tenantA = ((await response.json()) as { data: { company: { id: string } } }).data.company.id;
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
      const login = await request('POST', '/auth/login', {
        identifier: `${name}@a.vn`,
        password: PASSWORD,
      });
      tokens[name] = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
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

  /** BĐS của `agent` tạo 31 ngày trước, chưa xác minh: lần chạy job tới sẽ chuyển VERIFY_REQUIRED. */
  async function overdueProperty(agent: string, title: string): Promise<string> {
    const response = await request(
      'POST',
      '/properties',
      {
        title,
        propertyType: 'HOUSE',
        price: 3_500_000_000,
        area: 70,
        provinceId: khanhHoa,
        wardId: vinhHai,
      },
      tokens[agent],
    );
    assert.equal(response.status, 201);
    const id = ((await response.json()) as { data: { id: string } }).data.id;
    await db.query(`UPDATE properties SET created_at = now() - interval '31 days' WHERE id = $1`, [
      id,
    ]);
    return id;
  }

  async function reminders(): Promise<NotificationRow[]> {
    return (await db.query(
      `SELECT user_id, title, body, data FROM notifications
        WHERE type = 'VERIFY_REQUIRED' ORDER BY created_at, user_id`,
    )) as NotificationRow[];
  }

  async function waitForReminders(count: number): Promise<NotificationRow[]> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const rows = await reminders();
      if (rows.length >= count) {
        return rows;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return reminders();
  }

  it('job chuyển BĐS quá hạn thì mỗi môi giới nhận một thông báo gộp BĐS của mình, chạy lại không báo lặp', async () => {
    const one = await overdueProperty('agent1', 'Nhà phố Vĩnh Hải');
    const many: string[] = [];
    for (let i = 1; i <= 4; i += 1) {
      many.push(await overdueProperty('agent2', `Căn ${i}`));
    }

    assert.equal(await properties.markOverdueForVerification(), 5);
    const rows = await waitForReminders(2);
    assert.equal(rows.length, 2);

    const forAgent1 = rows.find((row) => row.user_id === user('agent1'));
    assert.equal(forAgent1?.title, VERIFY_REQUIRED_TITLE);
    assert.match(
      forAgent1?.body ?? '',
      /^BDS-\d{6} Nhà phố Vĩnh Hải đã quá hạn xác minh, cần xác minh lại để tiếp tục bán\.$/,
    );
    assert.deepEqual(forAgent1?.data, { count: 1, propertyIds: [one] });

    const forAgent2 = rows.find((row) => row.user_id === user('agent2'));
    assert.match(
      forAgent2?.body ?? '',
      /^4 BĐS đã quá hạn xác minh: BDS-\d{6}, BDS-\d{6}, BDS-\d{6} và 1 BĐS khác\. Cần xác minh lại để tiếp tục bán\.$/,
    );
    assert.equal(forAgent2?.data.count, 4);
    assert.deepEqual([...(forAgent2?.data.propertyIds ?? [])].sort(), [...many].sort());

    assert.equal(await properties.markOverdueForVerification(), 0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal((await reminders()).length, 2);
  });

  it('môi giới bị khoá thì không nhận', async () => {
    const notifier = app.get(VerifyReminderNotifier);
    await db.query(`UPDATE users SET status = 'LOCKED' WHERE id = $1`, [user('agent1')]);
    try {
      assert.equal(
        await notifier.handle([
          {
            tenantId: tenantA,
            propertyId: '00000000-0000-4000-8000-000000000000',
            agentId: user('agent1'),
            code: 'BDS-999999',
            title: 'Không có thật',
          },
        ]),
        0,
      );
    } finally {
      await db.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [user('agent1')]);
    }
  });
});
