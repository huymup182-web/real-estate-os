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
describe('/api/v1/appointments', () => {
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

  describe('POST', () => {
    it('tạo lịch hẹn → 201: môi giới là người tạo, SCHEDULED, kèm tên khách và BĐS; ghi nhật ký', async () => {
      const customerId = await createCustomer();
      const propertyId = await createProperty();
      const scheduledAt = inHours(30);
      const appointment = await book({
        customerId,
        propertyId,
        scheduledAt,
        durationMinutes: 45,
        location: '  Trước cổng chung cư  ',
        notes: 'Khách đi cùng vợ',
      });
      assert.deepEqual(appointment.customer, { id: customerId, fullName: 'Khách được chăm sóc' });
      assert.equal(appointment.property.id, propertyId);
      assert.match(appointment.property.code, /^BDS-\d{6}$/);
      assert.equal(appointment.property.title, 'Nhà phố Vĩnh Hải');
      assert.equal(appointment.agentId, userIds['agent1']);
      assert.equal(appointment.scheduledAt, scheduledAt);
      assert.equal(appointment.durationMinutes, 45);
      assert.equal(appointment.location, 'Trước cổng chung cư');
      assert.equal(appointment.notes, 'Khách đi cùng vợ');
      assert.equal(appointment.status, 'SCHEDULED');
      assert.equal(appointment.outcome, null);
      assert.equal(appointment.createdBy, userIds['agent1']);
      assert.equal('tenantId' in appointment, false);
      const [audit] = (await db.query(
        `SELECT user_id FROM audit_logs WHERE entity_type = 'appointment' AND entity_id = $1
            AND action = 'appointment.create'`,
        [appointment.id],
      )) as { user_id: string }[];
      assert.equal(audit?.user_id, userIds['agent1']);
    });

    it('dữ liệu sai → 400 kèm trường lỗi', async () => {
      const customerId = await createCustomer();
      const propertyId = await createProperty();
      const valid = { customerId, propertyId, scheduledAt: inHours(2) };
      for (const [payload, field] of [
        [{ ...valid, customerId: undefined }, 'customerId'],
        [{ ...valid, customerId: 'abc' }, 'customerId'],
        [{ ...valid, propertyId: undefined }, 'propertyId'],
        [{ ...valid, scheduledAt: undefined }, 'scheduledAt'],
        [{ ...valid, scheduledAt: 'mai' }, 'scheduledAt'],
        [{ ...valid, scheduledAt: inHours(-1) }, 'scheduledAt'],
        [{ ...valid, durationMinutes: 0 }, 'durationMinutes'],
        [{ ...valid, durationMinutes: 1441 }, 'durationMinutes'],
        [{ ...valid, durationMinutes: 1.5 }, 'durationMinutes'],
        [{ ...valid, location: 'x'.repeat(256) }, 'location'],
        [{ ...valid, notes: '<script>x</script>' }, 'notes'],
        [{ ...valid, status: 'COMPLETED' }, 'status'],
        [{ ...valid, agentId: userIds['agent2'] }, 'agentId'],
      ] as const) {
        const error = await errorOf(await as('agent1', 'POST', '/appointments', payload), 400);
        assert.ok(fieldsOf(error).includes(field), `${field}: ${JSON.stringify(error.details)}`);
      }
    });

    it('khách hoặc BĐS không xem được (không có, công ty khác, ngoài phạm vi) → 400', async () => {
      const mine = await createCustomer();
      const property = await createProperty();
      const othersCustomer = await createCustomer('agent2');
      const otherTenantCustomer = await createCustomer('_', tokens['otherAdmin']);
      const otherTenantProperty = await createProperty(tokens['otherAdmin']);
      for (const customerId of [MISSING, othersCustomer, otherTenantCustomer]) {
        const error = await errorOf(
          await as('agent1', 'POST', '/appointments', {
            customerId,
            propertyId: property,
            scheduledAt: inHours(2),
          }),
          400,
        );
        assert.deepEqual(fieldsOf(error), ['customerId'], customerId);
      }
      for (const propertyId of [MISSING, otherTenantProperty]) {
        const error = await errorOf(
          await as('agent1', 'POST', '/appointments', {
            customerId: mine,
            propertyId,
            scheduledAt: inHours(2),
          }),
          400,
        );
        assert.deepEqual(fieldsOf(error), ['propertyId'], propertyId);
      }
    });

    it('trưởng nhóm hẹn cho khách của nhóm; CTV hẹn cho khách của mình; chưa đăng nhập → 401', async () => {
      const customerId = await createCustomer();
      const leaderBooking = await book({ customerId }, 'leader');
      assert.equal(leaderBooking.agentId, userIds['leader']);
      await book({}, 'collab');
      assert.equal((await request('POST', '/appointments', {})).status, 401);
    });
  });

  describe('GET', () => {
    it('xem theo phạm vi: OWN, TEAM, DEPARTMENT, COMPANY; ngoài phạm vi → 404', async () => {
      const appointment = await book();
      for (const user of ['agent1', 'leader', 'manager', 'admin', 'viewer']) {
        const response = await as(user, 'GET', `/appointments/${appointment.id}`);
        assert.equal(response.status, 200, user);
        assert.equal(((await response.json()) as { data: Appointment }).data.id, appointment.id);
      }
      for (const user of ['agent2', 'collab', 'agent4']) {
        assert.equal(
          (await errorOf(await as(user, 'GET', `/appointments/${appointment.id}`), 404)).code,
          'NOT_FOUND',
          user,
        );
      }
      assert.equal(
        (await request('GET', `/appointments/${appointment.id}`, undefined, tokens['otherAdmin']))
          .status,
        404,
      );
      assert.equal((await as('admin', 'GET', '/appointments/abc')).status, 400);
      assert.equal((await request('GET', `/appointments/${appointment.id}`)).status, 401);
    });

    it('danh sách: giờ hẹn sớm trước, lọc khoảng thời gian, khách, BĐS; phân trang', async () => {
      const customerId = await createCustomer('agent4');
      const propertyId = await createProperty(tokens['agent4']);
      const later = await book({ customerId, propertyId, scheduledAt: inHours(72) }, 'agent4');
      const sooner = await book({ customerId, propertyId, scheduledAt: inHours(3) }, 'agent4');
      const otherCustomer = await book({ propertyId, scheduledAt: inHours(48) }, 'agent4');

      const list = async (query: string, user = 'agent4'): Promise<AppointmentPage> => {
        const response = await as(user, 'GET', `/appointments${query}`);
        assert.equal(response.status, 200, query);
        return (await response.json()) as AppointmentPage;
      };
      const all = await list('?pageSize=100');
      assert.deepEqual(
        all.data.map((item) => item.id),
        [sooner.id, otherCustomer.id, later.id],
      );
      assert.equal(all.meta.total, 3);
      assert.deepEqual(
        (await list(`?customerId=${customerId}`)).data.map((item) => item.id),
        [sooner.id, later.id],
      );
      assert.deepEqual(
        (
          await list(
            `?from=${encodeURIComponent(inHours(24))}&to=${encodeURIComponent(inHours(60))}`,
          )
        ).data.map((item) => item.id),
        [otherCustomer.id],
      );
      assert.equal((await list(`?propertyId=${propertyId}`)).meta.total, 3);
      const page2 = await list('?page=2&pageSize=2');
      assert.deepEqual(
        page2.data.map((item) => item.id),
        [later.id],
      );
      assert.equal(
        (await list('?pageSize=100', 'agent1')).data.some((item) => item.id === later.id),
        false,
      );
      assert.ok((await list('?pageSize=100', 'admin')).data.some((item) => item.id === later.id));
      assert.equal((await list('?pageSize=100', 'otherAdmin')).meta.total, 0);

      for (const query of [
        `?from=${encodeURIComponent(inHours(5))}&to=${encodeURIComponent(inHours(1))}`,
        '?from=hôm-qua',
        '?customerId=abc',
        '?pageSize=0',
      ]) {
        assert.equal((await as('agent4', 'GET', `/appointments${query}`)).status, 400, query);
      }
    });
  });

  describe('PATCH /:id', () => {
    it('sửa trường được gửi → 200; null xoá giá trị; đổi BĐS; ghi nhật ký thay đổi', async () => {
      const appointment = await book({ location: 'Cổng A', durationMinutes: 30 });
      const newProperty = await createProperty();
      const scheduledAt = inHours(50);
      const response = await as('agent1', 'PATCH', `/appointments/${appointment.id}`, {
        scheduledAt,
        location: null,
        notes: '  Mang theo sổ  ',
        propertyId: newProperty,
        expectedUpdatedAt: appointment.updatedAt,
      });
      assert.equal(response.status, 200);
      const updated = ((await response.json()) as { data: Appointment }).data;
      assert.equal(updated.scheduledAt, scheduledAt);
      assert.equal(updated.location, null);
      assert.equal(updated.notes, 'Mang theo sổ');
      assert.equal(updated.property.id, newProperty);
      assert.equal(updated.durationMinutes, 30);
      assert.equal(updated.updatedBy, userIds['agent1']);
      const [audit] = (await db.query(
        `SELECT changes FROM audit_logs WHERE entity_id = $1 AND action = 'appointment.update'`,
        [appointment.id],
      )) as { changes: Record<string, unknown> }[];
      assert.deepEqual(Object.keys(audit?.changes ?? {}).sort(), [
        'location',
        'notes',
        'propertyId',
        'scheduledAt',
      ]);
    });

    it('dữ liệu sai → 400; expectedUpdatedAt cũ → 409', async () => {
      const appointment = await book();
      const path = `/appointments/${appointment.id}`;
      for (const payload of [
        {},
        { scheduledAt: null },
        { scheduledAt: inHours(-2) },
        { propertyId: null },
        { propertyId: MISSING },
        { durationMinutes: 0 },
        { customerId: MISSING },
        { status: 'COMPLETED' },
        { outcome: 'INTERESTED' },
      ]) {
        assert.equal(
          (await as('agent1', 'PATCH', path, payload)).status,
          400,
          JSON.stringify(payload),
        );
      }
      assert.equal((await as('agent1', 'PATCH', path, { notes: 'lần 1' })).status, 200);
      assert.equal(
        (
          await errorOf(
            await as('agent1', 'PATCH', path, {
              notes: 'lần 2',
              expectedUpdatedAt: appointment.updatedAt,
            }),
            409,
          )
        ).code,
        'CONFLICT',
      );
    });

    it('quyền: trưởng nhóm, trưởng phòng sửa được; chỉ xem được → 403; ngoài phạm vi → 404', async () => {
      const appointment = await book();
      const path = `/appointments/${appointment.id}`;
      for (const user of ['leader', 'manager', 'admin']) {
        assert.equal((await as(user, 'PATCH', path, { notes: user })).status, 200, user);
      }
      assert.equal(
        (await errorOf(await as('viewer', 'PATCH', path, { notes: 'x' }), 403)).code,
        'FORBIDDEN',
      );
      for (const user of ['agent2', 'collab', 'agent4']) {
        assert.equal((await as(user, 'PATCH', path, { notes: 'x' })).status, 404, user);
      }
    });
  });

  describe('DELETE /:id', () => {
    it('xoá mềm → 204; không đọc được nữa; còn trong DB; xoá lần hai → 404', async () => {
      const appointment = await book();
      const response = await as('agent1', 'DELETE', `/appointments/${appointment.id}`);
      assert.equal(response.status, 204);
      assert.equal(await response.text(), '');
      assert.equal((await as('admin', 'GET', `/appointments/${appointment.id}`)).status, 404);
      const [row] = (await db.query(
        'SELECT deleted_at, updated_by FROM appointments WHERE id = $1',
        [appointment.id],
      )) as { deleted_at: Date | null; updated_by: string }[];
      assert.ok(row?.deleted_at);
      assert.equal(row.updated_by, userIds['agent1']);
      assert.equal((await as('agent1', 'DELETE', `/appointments/${appointment.id}`)).status, 404);
    });

    it('chỉ xem được → 403; ngoài phạm vi, công ty khác → 404', async () => {
      const appointment = await book();
      const path = `/appointments/${appointment.id}`;
      assert.equal((await as('viewer', 'DELETE', path)).status, 403);
      for (const user of ['agent2', 'agent4']) {
        assert.equal((await as(user, 'DELETE', path)).status, 404, user);
      }
      assert.equal((await request('DELETE', path, undefined, tokens['otherAdmin'])).status, 404);
      assert.equal((await as('manager', 'DELETE', path)).status, 204);
    });
  });
});
