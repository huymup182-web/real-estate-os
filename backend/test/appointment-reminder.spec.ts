import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import {
  APPOINTMENT_REMINDER_TITLE,
  AppointmentReminderJob,
  formatAppointmentTime,
} from '../src/notifications/appointment-reminder.job.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

/** Công ty A, admin vừa là người đặt vừa là môi giới phụ trách lịch hẹn. */
describe('Nhắc lịch hẹn (TASK-097)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let job: AppointmentReminderJob;
  let adminId: string;
  let token: string;
  let customerId: string;
  let propertyId: string;

  before(async () => {
    await useTestDatabase();
    app = await createApp();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    db = app.get(DataSource);
    job = app.get(AppointmentReminderJob);

    const khanhHoa = await insertId(
      `INSERT INTO provinces (code, name) VALUES ('56', 'Khánh Hòa')`,
    );
    const vinhHai = await insertId(
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
    adminId = ((await response.json()) as { data: { user: { id: string } } }).data.user.id;
    const login = await request('POST', '/auth/login', {
      identifier: 'admin@a.vn',
      password: PASSWORD,
    });
    token = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;

    customerId = await post('/customers', { fullName: 'Anh An', phone: '+84901234567' });
    propertyId = await post('/properties', {
      title: 'Nhà phố Vĩnh Hải',
      propertyType: 'HOUSE',
      price: 3_500_000_000,
      area: 70,
      provinceId: khanhHoa,
      wardId: vinhHai,
    });
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

  function request(method: string, path: string, payload?: unknown): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  }

  async function post(path: string, payload: unknown): Promise<string> {
    const response = await request('POST', path, payload);
    assert.equal(response.status, 201, await response.clone().text());
    return ((await response.json()) as { data: { id: string } }).data.id;
  }

  const inMinutes = (minutes: number): Date => new Date(Date.now() + minutes * 60_000);

  async function book(minutes: number, location?: string): Promise<string> {
    return post('/appointments', {
      customerId,
      propertyId,
      scheduledAt: inMinutes(minutes).toISOString(),
      ...(location ? { location } : {}),
    });
  }

  async function reminders(appointmentId: string): Promise<{ title: string; body: string }[]> {
    return (await db.query(
      `SELECT title, body FROM notifications
        WHERE type = 'VIEWING_REMINDER' AND user_id = $1 AND data->>'appointmentId' = $2`,
      [adminId, appointmentId],
    )) as { title: string; body: string }[];
  }

  async function reminderSentAt(appointmentId: string): Promise<Date | null> {
    const [row] = (await db.query(`SELECT reminder_sent_at FROM appointments WHERE id = $1`, [
      appointmentId,
    ])) as { reminder_sent_at: Date | null }[];
    return row?.reminder_sent_at ?? null;
  }

  it('nhắc môi giới một lần khi lịch sắp diễn ra trong 60 phút tới', async () => {
    const id = await book(30, '12 Lê Lợi');
    await job.sendDue();
    await job.sendDue();

    const rows = await reminders(id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.title, APPOINTMENT_REMINDER_TITLE);
    assert.match(
      rows[0]?.body ?? '',
      /^\d{2}:\d{2} ngày \d{2}\/\d{2} · Anh An xem BDS-\d{6} Nhà phố Vĩnh Hải\. Địa điểm: 12 Lê Lợi$/,
    );
    assert.ok(await reminderSentAt(id));
  });

  it('không nhắc lịch còn xa, đã huỷ, đã xoá hoặc đã qua giờ', async () => {
    const far = await book(180);
    const cancelled = await book(20);
    await db.query(`UPDATE appointments SET status = 'CANCELLED' WHERE id = $1`, [cancelled]);
    const deleted = await book(20);
    await db.query(`UPDATE appointments SET deleted_at = now() WHERE id = $1`, [deleted]);
    const past = await book(20);
    await db.query(
      `UPDATE appointments SET scheduled_at = now() - interval '10 minutes' WHERE id = $1`,
      [past],
    );

    await job.sendDue();
    for (const id of [far, cancelled, deleted, past]) {
      assert.deepEqual(await reminders(id), [], id);
      assert.equal(await reminderSentAt(id), null);
    }
  });

  it('đổi giờ hẹn thì nhắc lại theo giờ mới', async () => {
    const id = await book(15);
    await job.sendDue();
    assert.equal((await reminders(id)).length, 1);

    const response = await request('PATCH', `/appointments/${id}`, {
      scheduledAt: inMinutes(45).toISOString(),
    });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(await reminderSentAt(id), null);

    await job.sendDue();
    assert.equal((await reminders(id)).length, 2);
    // Sửa trường khác không làm nhắc lại.
    const notes = await request('PATCH', `/appointments/${id}`, { notes: 'Mang theo sổ' });
    assert.equal(notes.status, 200);
    assert.ok(await reminderSentAt(id));
  });

  it('hiển thị giờ hẹn theo giờ Việt Nam', () => {
    assert.equal(formatAppointmentTime(new Date('2026-10-09T07:30:00Z')), '14:30 ngày 09/10');
    assert.equal(formatAppointmentTime(new Date('2026-12-31T17:05:00Z')), '00:05 ngày 01/01');
  });
});
