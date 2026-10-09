import 'reflect-metadata';

import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { type PushMessage, PushSender } from '../src/notifications/push-sender.js';
import { useTestDatabase } from './support/test-database.js';

const MISSING = '00000000-0000-4000-8000-000000000000';

interface NotificationRow {
  tenant_id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: Date | null;
  push_sent_at: Date | null;
}

/** Công ty A: agent1, agent2 (ACTIVE), `locked` (LOCKED), `removed` (đã xoá); công ty B: otherUser. */
describe('NotificationsService (TASK-092)', () => {
  let app: INestApplication;
  let db: DataSource;
  let notifications: NotificationsService;
  let push: PushSender;
  let originalSend: PushSender['send'];
  let tenantA: string;
  const userIds: Record<string, string> = {};
  const pushed: PushMessage[] = [];

  before(async () => {
    await useTestDatabase();
    app = await createApp();
    app.useLogger(false);
    db = app.get(DataSource);
    notifications = app.get(NotificationsService);
    push = app.get(PushSender);
    originalSend = push.send.bind(push);

    tenantA = await insertId(
      `INSERT INTO companies (name, slug) VALUES ('Công ty A', 'cong-ty-a')`,
    );
    const tenantB = await insertId(
      `INSERT INTO companies (name, slug) VALUES ('Công ty B', 'cong-ty-b')`,
    );
    for (const [name, tenant, status, deleted] of [
      ['agent1', tenantA, 'ACTIVE', false],
      ['agent2', tenantA, 'ACTIVE', false],
      ['locked', tenantA, 'LOCKED', false],
      ['removed', tenantA, 'ACTIVE', true],
      ['otherUser', tenantB, 'ACTIVE', false],
    ] as const) {
      userIds[name] = await insertId(
        `INSERT INTO users (tenant_id, email, password_hash, full_name, status, deleted_at)
         VALUES ($1, $2, 'x', $3, $4, $5)`,
        [tenant, `${name}@test.vn`, name, status, deleted ? new Date() : null],
      );
    }
  });

  afterEach(() => {
    push.send = originalSend;
    pushed.length = 0;
  });

  after(async () => {
    await app.close();
  });

  async function insertId(sql: string, params: unknown[] = []): Promise<string> {
    const [row] = (await db.query(`${sql} RETURNING id`, params)) as { id: string }[];
    assert.ok(row);
    return row.id;
  }

  function id(name: string): string {
    const value = userIds[name];
    assert.ok(value, name);
    return value;
  }

  async function rowOf(notificationId: string): Promise<NotificationRow> {
    const [row] = (await db.query(`SELECT * FROM notifications WHERE id = $1`, [
      notificationId,
    ])) as NotificationRow[];
    assert.ok(row);
    return row;
  }

  const valid = {
    type: 'SYSTEM_NOTIFICATION' as const,
    title: '  Chào mừng  ',
    body: '  Tài khoản đã sẵn sàng  ',
  };

  it('ghi hộp thư cho từng người nhận (id trùng gửi một lần) và đẩy qua PushSender', async () => {
    push.send = (message) => {
      pushed.push(message);
      return Promise.resolve(false);
    };
    const created = await notifications.notify({
      ...valid,
      tenantId: tenantA,
      userIds: [id('agent1'), id('agent2'), id('agent1')],
      data: { propertyId: MISSING },
    });
    assert.deepEqual(
      created.map((item) => item.userId).sort(),
      [id('agent1'), id('agent2')].sort(),
    );
    const first = created[0];
    assert.ok(first);
    const row = await rowOf(first.id);
    assert.equal(row.tenant_id, tenantA);
    assert.equal(row.type, 'SYSTEM_NOTIFICATION');
    assert.equal(row.title, 'Chào mừng');
    assert.equal(row.body, 'Tài khoản đã sẵn sàng');
    assert.deepEqual(row.data, { propertyId: MISSING });
    assert.equal(row.read_at, null);
    // Kênh đẩy trả false (chưa đẩy được) → push_sent_at để trống.
    assert.equal(row.push_sent_at, null);
    assert.deepEqual(
      pushed.map((message) => [message.notificationId, message.userId, message.title]).sort(),
      created.map((item) => [item.id, item.userId, 'Chào mừng']).sort(),
    );
    assert.deepEqual(pushed[0]?.data, { propertyId: MISSING });
  });

  it('bỏ qua user bị khoá, đã xoá, công ty khác, không tồn tại; không ai nhận → []', async () => {
    const created = await notifications.notify({
      ...valid,
      tenantId: tenantA,
      userIds: [id('agent1'), id('locked'), id('removed'), id('otherUser'), MISSING],
    });
    assert.deepEqual(
      created.map((item) => item.userId),
      [id('agent1')],
    );
    assert.deepEqual(
      await notifications.notify({ ...valid, tenantId: tenantA, userIds: [id('otherUser')] }),
      [],
    );
    assert.deepEqual(await notifications.notify({ ...valid, tenantId: tenantA, userIds: [] }), []);
  });

  it('đẩy được → ghi push_sent_at; đẩy lỗi → thông báo vẫn được lưu, không ném lỗi', async () => {
    push.send = () => Promise.resolve(true);
    const [sent] = await notifications.notify({
      ...valid,
      tenantId: tenantA,
      userIds: [id('agent1')],
    });
    assert.ok(sent);
    assert.notEqual((await rowOf(sent.id)).push_sent_at, null);

    push.send = () => Promise.reject(new Error('FCM lỗi'));
    const [failed] = await notifications.notify({
      ...valid,
      tenantId: tenantA,
      userIds: [id('agent2')],
    });
    assert.ok(failed);
    assert.equal((await rowOf(failed.id)).push_sent_at, null);
  });

  it('đầu vào sai → ném lỗi, không ghi gì', async () => {
    const before = (
      (await db.query(`SELECT count(*)::int AS n FROM notifications`)) as [{ n: number }]
    )[0].n;
    const base = { ...valid, tenantId: tenantA, userIds: [id('agent1')] };
    for (const input of [
      { ...base, type: 'HELLO' },
      { ...base, title: '   ' },
      { ...base, title: 'x'.repeat(256) },
      { ...base, body: '' },
      { ...base, body: 'x'.repeat(2001) },
      { ...base, data: [1, 2] },
      { ...base, data: { text: 'x'.repeat(4000) } },
      { ...base, userIds: Array.from({ length: 1001 }, () => id('agent1')) },
      { ...base, tenantId: 'abc' },
    ]) {
      await assert.rejects(
        notifications.notify(input as Parameters<NotificationsService['notify']>[0]),
        Error,
      );
    }
    const afterCount = (
      (await db.query(`SELECT count(*)::int AS n FROM notifications`)) as [{ n: number }]
    )[0].n;
    assert.equal(afterCount, before);
  });
});
