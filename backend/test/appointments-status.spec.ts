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

interface Activity {
  type: string;
  propertyIds: string[] | null;
  metadata: Record<string, unknown>;
  user: { id: string; fullName: string };
}

interface Appointment {
  id: string;
  customer: { id: string; fullName: string };
  property: { id: string; code: string; title: string };
  agentId: string;
  scheduledAt: string;
  durationMinutes: number | null;
  location: string | null;
  notes: string | null;
  status: string;
  outcome: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

interface AppointmentPage {
  data: Appointment[];
  meta: { page: number; pageSize: number; total: number };
}

interface ApiError {
  error: { code: string; details?: { field?: string }[] };
}

/**
 * Công ty A: admin; phòng D1 có `manager` và team T1 (trưởng nhóm `leader`) gồm agent1, agent2, cộng tác viên
 * `collab`; phòng D2 có agent4; `viewer` (role tuỳ chỉnh: xem lịch hẹn COMPANY, quản lý lịch OWN).
 * Lịch hẹn mặc định do agent1 tạo, với khách và BĐS của agent1.
 */
describe('/api/v1/appointments/:id/status', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
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

    khanhHoa = await insertId(`INSERT INTO provinces (code, name) VALUES ('56', 'Khánh Hòa')`);
    vinhHai = await insertId(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, '22330', 'Vĩnh Hải')`,
      [khanhHoa],
    );
    const admin = await register('admin@a.vn');
    tenantA = admin.tenantId;
    userIds['admin'] = admin.userId;
    const d1 = await insertId(`INSERT INTO departments (tenant_id, name) VALUES ($1, 'D1')`, [
      tenantA,
    ]);
    const d2 = await insertId(`INSERT INTO departments (tenant_id, name) VALUES ($1, 'D2')`, [
      tenantA,
    ]);
    const viewerRole = await insertId(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'APPOINTMENT_VIEWER', 'Xem lịch')`,
      [tenantA],
    );
    await db.query(
      `INSERT INTO role_permissions (role_id, permission_id, scope)
       SELECT $1, id, CASE WHEN code = 'appointment.view' THEN 'COMPANY' ELSE 'OWN' END
         FROM permissions WHERE code IN ('appointment.view', 'appointment.manage')`,
      [viewerRole],
    );
    const hash = await hashPassword(PASSWORD);
    for (const [name, role, department] of [
      ['manager', 'MANAGER', d1],
      ['leader', 'TEAM_LEADER', d1],
      ['agent1', 'AGENT', d1],
      ['agent2', 'AGENT', d1],
      ['collab', 'COLLABORATOR', d1],
      ['agent4', 'AGENT', d2],
      ['viewer', 'APPOINTMENT_VIEWER', d2],
    ] as const) {
      userIds[name] = await insertUser(name, hash, department, role);
    }
    const team = await insertId(
      `INSERT INTO teams (tenant_id, department_id, name, leader_id) VALUES ($1, $2, 'T1', $3)`,
      [tenantA, d1, userIds['leader']],
    );
    for (const name of ['agent1', 'agent2', 'collab']) {
      await db.query(`INSERT INTO team_members (tenant_id, team_id, user_id) VALUES ($1, $2, $3)`, [
        tenantA,
        team,
        userIds[name],
      ]);
    }
    for (const name of Object.keys(userIds)) {
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

  async function insertUser(
    name: string,
    hash: string,
    department: string,
    roleCode: string,
  ): Promise<string> {
    const id = await insertId(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, department_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantA, `${name}@a.vn`, hash, name, department],
    );
    await db.query(
      `INSERT INTO user_roles (user_id, role_id, tenant_id)
       SELECT $1, id, tenant_id FROM roles WHERE tenant_id = $2 AND code = $3`,
      [id, tenantA, roleCode],
    );
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

  function as(user: string, method: string, path: string, payload?: unknown): Promise<Response> {
    return request(method, path, payload, tokens[user]);
  }

  async function createCustomer(user = 'agent1', token = tokens[user]): Promise<string> {
    const response = await request(
      'POST',
      '/customers',
      { fullName: 'Khách được chăm sóc', phone: '+84901234567' },
      token,
    );
    assert.equal(response.status, 201);
    return ((await response.json()) as { data: { id: string } }).data.id;
  }

  async function createProperty(token = tokens['agent1']): Promise<string> {
    const response = await request(
      'POST',
      '/properties',
      {
        title: 'Nhà phố Vĩnh Hải',
        propertyType: 'HOUSE',
        price: 3_500_000_000,
        area: 70,
        provinceId: khanhHoa,
        wardId: vinhHai,
      },
      token,
    );
    assert.equal(response.status, 201);
    return ((await response.json()) as { data: { id: string } }).data.id;
  }

  const inHours = (hours: number): string =>
    new Date(Date.now() + hours * 3600 * 1000).toISOString();

  async function book(
    payload: Record<string, unknown> = {},
    user = 'agent1',
  ): Promise<Appointment> {
    const customerId =
      (payload['customerId'] as string | undefined) ?? (await createCustomer(user));
    const propertyId =
      (payload['propertyId'] as string | undefined) ?? (await createProperty(tokens[user]));
    const response = await as(user, 'POST', '/appointments', {
      scheduledAt: inHours(24),
      ...payload,
      customerId,
      propertyId,
    });
    assert.equal(response.status, 201, await response.clone().text());
    return ((await response.json()) as { data: Appointment }).data;
  }

  async function errorOf(response: Response, status: number): Promise<ApiError['error']> {
    assert.equal(response.status, status);
    return ((await response.json()) as ApiError).error;
  }

  function fieldsOf(error: ApiError['error']): string[] {
    return [...new Set(error.details?.map((detail) => detail.field ?? ''))];
  }

  /** Lịch hẹn đã tới giờ: đặt lịch ngày mai rồi lùi giờ hẹn trực tiếp trong DB. */
  async function bookPast(user = 'agent1'): Promise<Appointment> {
    const appointment = await book({}, user);
    await db.query(
      `UPDATE appointments SET scheduled_at = now() - interval '1 hour' WHERE id = $1`,
      [appointment.id],
    );
    const response = await as(user, 'GET', `/appointments/${appointment.id}`);
    return ((await response.json()) as { data: Appointment }).data;
  }

  function changeStatus(
    id: string,
    payload: Record<string, unknown>,
    user = 'agent1',
  ): Promise<Response> {
    return as(user, 'POST', `/appointments/${id}/status`, payload);
  }

  async function changed(response: Response): Promise<Appointment> {
    assert.equal(response.status, 200, await response.clone().text());
    return ((await response.json()) as { data: Appointment }).data;
  }

  async function viewings(customerId: string): Promise<Activity[]> {
    const response = await as('agent1', 'GET', `/customers/${customerId}/activities?type=VIEWING`);
    assert.equal(response.status, 200);
    return ((await response.json()) as { data: Activity[] }).data;
  }

  it('đã xem xong kèm kết quả → 200; ghi nhật ký và một buổi xem lên timeline của khách', async () => {
    const appointment = await bookPast();
    const updated = await changed(
      await changeStatus(appointment.id, {
        status: 'COMPLETED',
        outcome: 'INTERESTED',
        expectedUpdatedAt: appointment.updatedAt,
      }),
    );
    assert.equal(updated.status, 'COMPLETED');
    assert.equal(updated.outcome, 'INTERESTED');
    assert.equal(updated.updatedBy, userIds['agent1']);

    const [audit] = (await db.query(
      `SELECT user_id, changes FROM audit_logs WHERE entity_type = 'appointment' AND entity_id = $1
          AND action = 'appointment.change_status'`,
      [appointment.id],
    )) as { user_id: string; changes: Record<string, unknown> }[];
    assert.equal(audit?.user_id, userIds['agent1']);
    assert.deepEqual(Object.keys(audit?.changes ?? {}).sort(), ['outcome', 'status']);

    const [viewing, ...rest] = await viewings(appointment.customer.id);
    assert.equal(rest.length, 0);
    assert.deepEqual(viewing?.propertyIds, [appointment.property.id]);
    assert.deepEqual(viewing?.metadata, {
      appointmentId: appointment.id,
      status: 'COMPLETED',
      outcome: 'INTERESTED',
    });
    assert.equal(viewing?.user.id, userIds['agent1']);
  });

  it('đã xem xong không ghi kết quả → 200 (không bắt buộc); khách không đến → NO_SHOW', async () => {
    const completed = await bookPast();
    const done = await changed(await changeStatus(completed.id, { status: 'COMPLETED' }));
    assert.equal(done.status, 'COMPLETED');
    assert.equal(done.outcome, null);
    assert.equal((await viewings(completed.customer.id))[0]?.metadata['outcome'], null);

    const missed = await bookPast();
    const noShow = await changed(await changeStatus(missed.id, { status: 'NO_SHOW' }));
    assert.equal(noShow.status, 'NO_SHOW');
    assert.equal((await viewings(missed.customer.id))[0]?.metadata['status'], 'NO_SHOW');
  });

  it('chưa tới giờ hẹn → COMPLETED, NO_SHOW bị 422; huỷ được và mở lại được lịch đã huỷ', async () => {
    const appointment = await book();
    for (const status of ['COMPLETED', 'NO_SHOW']) {
      const error = await errorOf(await changeStatus(appointment.id, { status }), 422);
      assert.equal(error.code, 'BUSINESS_RULE_VIOLATION', status);
    }
    const cancelled = await changed(await changeStatus(appointment.id, { status: 'CANCELLED' }));
    assert.equal(cancelled.status, 'CANCELLED');
    const reopened = await changed(await changeStatus(appointment.id, { status: 'SCHEDULED' }));
    assert.equal(reopened.status, 'SCHEDULED');
    assert.deepEqual(await viewings(appointment.customer.id), []);
  });

  it('rời COMPLETED thì xoá kết quả; gửi lại đúng trạng thái và kết quả cũ thì không ghi gì thêm', async () => {
    const appointment = await bookPast();
    await changed(
      await changeStatus(appointment.id, { status: 'COMPLETED', outcome: 'NEED_FOLLOW_UP' }),
    );
    await changed(
      await changeStatus(appointment.id, { status: 'COMPLETED', outcome: 'NEED_FOLLOW_UP' }),
    );
    assert.equal((await viewings(appointment.customer.id)).length, 1);
    const [{ count }] = (await db.query(
      `SELECT count(*)::int AS count FROM audit_logs WHERE entity_id = $1
          AND action = 'appointment.change_status'`,
      [appointment.id],
    )) as [{ count: number }];
    assert.equal(count, 1);

    const cancelled = await changed(await changeStatus(appointment.id, { status: 'CANCELLED' }));
    assert.equal(cancelled.outcome, null);
  });

  it('dữ liệu sai → 400 kèm trường lỗi; expectedUpdatedAt cũ → 409', async () => {
    const appointment = await bookPast();
    for (const [payload, field] of [
      [{}, 'status'],
      [{ status: 'DONE' }, 'status'],
      [{ status: 'COMPLETED', outcome: 'GOOD' }, 'outcome'],
      [{ status: 'NO_SHOW', outcome: 'INTERESTED' }, 'outcome'],
      [{ status: 'CANCELLED', outcome: 'INTERESTED' }, 'outcome'],
      [{ status: 'CANCELLED', expectedUpdatedAt: 'hôm qua' }, 'expectedUpdatedAt'],
      [{ status: 'CANCELLED', notes: 'x' }, 'notes'],
    ] as const) {
      const error = await errorOf(await changeStatus(appointment.id, payload), 400);
      assert.ok(fieldsOf(error).includes(field), `${field}: ${JSON.stringify(error.details)}`);
    }
    await changed(await changeStatus(appointment.id, { status: 'CANCELLED' }));
    const conflict = await errorOf(
      await changeStatus(appointment.id, {
        status: 'SCHEDULED',
        expectedUpdatedAt: appointment.updatedAt,
      }),
      409,
    );
    assert.equal(conflict.code, 'CONFLICT');
  });

  it('phân quyền: trưởng nhóm đổi được; ngoài phạm vi xem → 404; xem được nhưng không quản lý → 403', async () => {
    const appointment = await bookPast();
    await changed(await changeStatus(appointment.id, { status: 'CANCELLED' }, 'leader'));
    for (const user of ['agent2', 'agent4']) {
      assert.equal((await changeStatus(appointment.id, { status: 'SCHEDULED' }, user)).status, 404);
    }
    assert.equal(
      (await changeStatus(appointment.id, { status: 'SCHEDULED' }, 'viewer')).status,
      403,
    );
    assert.equal(
      (
        await request(
          'POST',
          `/appointments/${appointment.id}/status`,
          { status: 'SCHEDULED' },
          tokens['otherAdmin'],
        )
      ).status,
      404,
    );
    assert.equal((await changeStatus(MISSING, { status: 'SCHEDULED' })).status, 404);
    assert.equal(
      (await request('POST', `/appointments/${appointment.id}/status`, { status: 'SCHEDULED' }))
        .status,
      401,
    );
  });

  it('danh sách lọc theo trạng thái (một hoặc nhiều); trạng thái sai → 400', async () => {
    const scheduled = await book({}, 'agent4');
    const cancelled = await book({}, 'agent4');
    const missed = await bookPast('agent4');
    await changed(await changeStatus(cancelled.id, { status: 'CANCELLED' }, 'agent4'));
    await changed(await changeStatus(missed.id, { status: 'NO_SHOW' }, 'agent4'));
    const ids = async (query: string): Promise<string[]> => {
      const response = await as('agent4', 'GET', `/appointments?pageSize=100&${query}`);
      assert.equal(response.status, 200, query);
      return ((await response.json()) as AppointmentPage).data.map((item) => item.id).sort();
    };
    assert.deepEqual(await ids('status=SCHEDULED'), [scheduled.id]);
    assert.deepEqual(await ids('status=CANCELLED,NO_SHOW'), [cancelled.id, missed.id].sort());
    assert.deepEqual(
      await ids('status=CANCELLED&status=NO_SHOW'),
      [cancelled.id, missed.id].sort(),
    );
    const error = await errorOf(await as('agent4', 'GET', '/appointments?status=DONE'), 400);
    assert.deepEqual(fieldsOf(error), ['status']);
  });
});
