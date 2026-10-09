import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { DeviceTokenStore } from '../src/notifications/device-token-store.js';
import { DeviceTokensService } from '../src/notifications/device-tokens.service.js';
import { MAX_DEVICES_PER_USER } from '../src/notifications/notification-values.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

interface Device {
  id: string;
  platform: string;
  lastSeenAt: string;
  createdAt: string;
  [key: string]: unknown;
}

/** Hai công ty A, B, mỗi công ty một admin (`a`, `b`). Mỗi test dùng token FCM riêng. */
describe('Thiết bị nhận thông báo /api/v1/device-tokens (TASK-094)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  const tokens: Record<string, string> = {};
  const users: Record<string, { userId: string; tenantId: string }> = {};

  before(async () => {
    await useTestDatabase();
    app = await createApp();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    db = app.get(DataSource);

    for (const name of ['a', 'b']) {
      users[name] = await register(`${name}@thiet-bi.vn`);
      tokens[name] = await login(`${name}@thiet-bi.vn`);
    }
  });

  after(async () => {
    await app.close();
  });

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

  function as(user: string, method: string, path: string, payload?: unknown): Promise<Response> {
    return request(method, path, payload, tokens[user]);
  }

  async function registerDevice(
    user: string,
    token: string,
    platform = 'ANDROID',
  ): Promise<Device> {
    const response = await as(user, 'POST', '/device-tokens', { token, platform });
    assert.equal(response.status, 201);
    return ((await response.json()) as { data: Device }).data;
  }

  async function devices(user: string): Promise<Device[]> {
    const response = await as(user, 'GET', '/device-tokens');
    assert.equal(response.status, 200);
    return ((await response.json()) as { data: Device[] }).data;
  }

  async function ownerOf(token: string): Promise<{ user_id: string; tenant_id: string } | null> {
    const rows: { user_id: string; tenant_id: string }[] = await db.query(
      'SELECT user_id, tenant_id FROM device_tokens WHERE fcm_token = $1',
      [token],
    );
    return rows[0] ?? null;
  }

  it('đăng ký token, đăng ký lại thì làm mới chứ không thêm dòng; danh sách không lộ token', async () => {
    const first = await registerDevice('a', 'fcm-lam-moi');
    assert.equal(first.platform, 'ANDROID');
    const again = await registerDevice('a', '  fcm-lam-moi ', 'IOS');
    assert.equal(again.id, first.id);
    assert.equal(again.platform, 'IOS');
    assert.ok(new Date(again.lastSeenAt) >= new Date(first.lastSeenAt));

    const listed = (await devices('a')).find((device) => device.id === first.id);
    assert.deepEqual(Object.keys(listed ?? {}).sort(), [
      'createdAt',
      'id',
      'lastSeenAt',
      'platform',
    ]);
  });

  it('kiểm tra dữ liệu và bắt buộc đăng nhập', async () => {
    for (const body of [
      {},
      { token: '', platform: 'ANDROID' },
      { token: 'co khoang trang', platform: 'ANDROID' },
      { token: 'x'.repeat(4097), platform: 'ANDROID' },
      { token: 'fcm-hop-le', platform: 'WINDOWS' },
      { token: 123, platform: 'IOS' },
    ]) {
      const response = await as('a', 'POST', '/device-tokens', body);
      assert.equal(response.status, 400, JSON.stringify(body).slice(0, 60));
    }
    assert.equal(
      (await request('POST', '/device-tokens', { token: 't', platform: 'IOS' })).status,
      401,
    );
    assert.equal((await request('GET', '/device-tokens')).status, 401);
    assert.equal((await as('a', 'DELETE', '/device-tokens/khong-phai-uuid')).status, 400);
  });

  it('thiết bị đổi người đăng nhập thì token chuyển sang người mới, kể cả khác công ty', async () => {
    const device = await registerDevice('a', 'fcm-doi-nguoi');
    await registerDevice('b', 'fcm-doi-nguoi');
    assert.deepEqual(await ownerOf('fcm-doi-nguoi'), {
      user_id: users['b']?.userId,
      tenant_id: users['b']?.tenantId,
    });
    assert.ok(!(await devices('a')).some((d) => d.id === device.id));
    assert.ok((await devices('b')).some((d) => d.id === device.id));
  });

  it(`giữ tối đa ${MAX_DEVICES_PER_USER} thiết bị mỗi người, gỡ thiết bị lâu không dùng nhất`, async () => {
    await db.query('DELETE FROM device_tokens WHERE user_id = $1', [users['a']?.userId]);
    for (let i = 0; i <= MAX_DEVICES_PER_USER; i += 1) {
      await registerDevice('a', `fcm-gioi-han-${i}`);
    }
    assert.equal((await devices('a')).length, MAX_DEVICES_PER_USER);
    assert.equal(await ownerOf('fcm-gioi-han-0'), null);
    assert.ok(await ownerOf(`fcm-gioi-han-${MAX_DEVICES_PER_USER}`));
  });

  it('gỡ thiết bị của mình; thiết bị người khác hoặc đã gỡ là 404', async () => {
    const device = await registerDevice('a', 'fcm-go');
    assert.equal((await as('b', 'DELETE', `/device-tokens/${device.id}`)).status, 404);
    assert.equal((await as('a', 'DELETE', `/device-tokens/${device.id}`)).status, 204);
    assert.equal(await ownerOf('fcm-go'), null);
    assert.equal((await as('a', 'DELETE', `/device-tokens/${device.id}`)).status, 404);
  });

  it('FCM lấy token còn hạn của người nhận và xoá được token hỏng', async () => {
    const store = app.get(DeviceTokenStore);
    assert.ok(store instanceof DeviceTokensService);
    const userId = users['b']?.userId ?? '';
    await db.query('DELETE FROM device_tokens WHERE user_id = $1', [userId]);
    await registerDevice('b', 'fcm-con-han');
    await registerDevice('b', 'fcm-qua-han');
    await registerDevice('b', 'fcm-hong');
    await db.query(
      `UPDATE device_tokens SET last_seen_at = now() - interval '271 days' WHERE fcm_token = $1`,
      ['fcm-qua-han'],
    );

    assert.deepEqual((await store.tokensOf(userId)).sort(), ['fcm-con-han', 'fcm-hong']);
    await store.remove(['fcm-hong', 'khong-ton-tai']);
    await store.remove([]);
    assert.deepEqual(await store.tokensOf(userId), ['fcm-con-han']);
  });
});
