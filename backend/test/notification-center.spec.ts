import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import type { NotificationType } from '../src/notifications/notification-values.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

interface Item {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

interface Page {
  data: Item[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

/** Hai công ty, mỗi công ty một admin (`a`, `b`). Mỗi test xoá hộp thư rồi tạo thông báo mới. */
describe('Trung tâm thông báo /api/v1/notifications (TASK-099)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let notifications: NotificationsService;
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
    notifications = app.get(NotificationsService);

    for (const name of ['a', 'b']) {
      const response = await request('POST', '/auth/register', {
        companyName: `Công ty ${name}`,
        fullName: 'Quản trị',
        email: `${name}@hop-thu.vn`,
        password: PASSWORD,
      });
      assert.equal(response.status, 201);
      const data = (
        (await response.json()) as { data: { user: { id: string }; company: { id: string } } }
      ).data;
      users[name] = { userId: data.user.id, tenantId: data.company.id };
      const login = await request('POST', '/auth/login', {
        identifier: `${name}@hop-thu.vn`,
        password: PASSWORD,
      });
      tokens[name] = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
    }
  });

  beforeEach(async () => {
    await db.query('DELETE FROM notifications');
  });

  after(async () => {
    await app.close();
  });

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

  function as(name: string, method: string, path: string): Promise<Response> {
    return request(method, path, undefined, tokens[name]);
  }

  /** Gửi một thông báo cho `name`; `minutesAgo` lùi thời điểm tạo để thứ tự rõ ràng. */
  async function send(
    name: string,
    title: string,
    type: NotificationType = 'SYSTEM_NOTIFICATION',
    minutesAgo = 0,
  ): Promise<string> {
    const target = users[name];
    assert.ok(target);
    const [created] = await notifications.notify({
      tenantId: target.tenantId,
      userIds: [target.userId],
      type,
      title,
      body: `Nội dung ${title}`,
      data: { ref: title },
    });
    assert.ok(created);
    await db.query(
      `UPDATE notifications SET created_at = now() - make_interval(mins => $2) WHERE id = $1`,
      [created.id, minutesAgo],
    );
    return created.id;
  }

  async function list(name: string, query = ''): Promise<Page> {
    const response = await as(name, 'GET', `/notifications${query}`);
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()) as Page;
  }

  async function unread(name: string): Promise<number> {
    const response = await as(name, 'GET', '/notifications/unread-count');
    assert.equal(response.status, 200);
    return ((await response.json()) as { data: { count: number } }).data.count;
  }

  it('liệt kê thông báo của mình, mới nhất trước, có phân trang', async () => {
    await send('a', 'Cũ', 'NEW_PROPERTY', 30);
    await send('a', 'Giữa', 'MATCHED_PROPERTY', 20);
    const newest = await send('a', 'Mới', 'VIEWING_REMINDER', 10);
    await send('b', 'Của công ty B');

    const page1 = await list('a', '?pageSize=2');
    assert.deepEqual(
      page1.data.map((item) => item.title),
      ['Mới', 'Giữa'],
    );
    assert.deepEqual(page1.meta, { page: 1, pageSize: 2, total: 3, totalPages: 2 });
    const [first] = page1.data;
    assert.equal(first?.id, newest);
    assert.equal(first.type, 'VIEWING_REMINDER');
    assert.equal(first.body, 'Nội dung Mới');
    assert.deepEqual(first.data, { ref: 'Mới' });
    assert.equal(first.readAt, null);
    assert.deepEqual(
      (await list('a', '?page=2&pageSize=2')).data.map((item) => item.title),
      ['Cũ'],
    );
    assert.deepEqual(
      (await list('b')).data.map((item) => item.title),
      ['Của công ty B'],
    );
  });

  it('lọc chưa đọc/đã đọc và theo loại; tham số sai → 400, chưa đăng nhập → 401', async () => {
    const read = await send('a', 'Đã đọc', 'NEW_PROPERTY', 3);
    await send('a', 'Chưa đọc', 'MATCHED_PROPERTY', 2);
    await send('a', 'Nhắc lịch', 'VIEWING_REMINDER', 1);
    assert.equal((await as('a', 'POST', `/notifications/${read}/read`)).status, 200);

    const titles = async (query: string): Promise<string[]> =>
      (await list('a', query)).data.map((item) => item.title);
    assert.deepEqual(await titles('?unread=true'), ['Nhắc lịch', 'Chưa đọc']);
    assert.deepEqual(await titles('?unread=false'), ['Đã đọc']);
    assert.deepEqual(await titles('?type=NEW_PROPERTY,MATCHED_PROPERTY'), ['Chưa đọc', 'Đã đọc']);
    assert.deepEqual(await titles('?type=MATCHED_PROPERTY&unread=false'), []);

    for (const query of ['?unread=co', '?type=KHAC', '?type=', '?pageSize=101']) {
      assert.equal((await as('a', 'GET', `/notifications${query}`)).status, 400, query);
    }
    assert.equal((await request('GET', '/notifications')).status, 401);
    assert.equal((await request('GET', '/notifications/unread-count')).status, 401);
  });

  it('đánh dấu đã đọc một thông báo: giữ thời điểm đọc đầu tiên; của người khác → 404', async () => {
    const id = await send('a', 'Một');
    await send('a', 'Hai');
    assert.equal(await unread('a'), 2);

    const first = await as('a', 'POST', `/notifications/${id}/read`);
    assert.equal(first.status, 200);
    const marked = ((await first.json()) as { data: Item }).data;
    assert.equal(marked.id, id);
    assert.ok(marked.readAt);
    assert.equal(await unread('a'), 1);

    const again = (
      (await (await as('a', 'POST', `/notifications/${id}/read`)).json()) as {
        data: Item;
      }
    ).data;
    assert.equal(again.readAt, marked.readAt);

    assert.equal((await as('b', 'POST', `/notifications/${id}/read`)).status, 404);
    assert.equal(
      (await as('a', 'POST', '/notifications/00000000-0000-4000-8000-000000000000/read')).status,
      404,
    );
    assert.equal((await as('a', 'POST', '/notifications/khong-phai-uuid/read')).status, 400);
  });

  it('đánh dấu tất cả đã đọc chỉ trong hộp thư của mình', async () => {
    await send('a', 'Một');
    await send('a', 'Hai');
    await send('b', 'Của B');

    const response = await as('a', 'POST', '/notifications/read-all');
    assert.equal(response.status, 200);
    assert.deepEqual(((await response.json()) as { data: { count: number } }).data, { count: 2 });
    assert.equal(await unread('a'), 0);
    assert.equal(await unread('b'), 1);

    const second = await as('a', 'POST', '/notifications/read-all');
    assert.deepEqual(((await second.json()) as { data: { count: number } }).data, { count: 0 });
  });
});
