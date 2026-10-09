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
const ENTITY = '11111111-1111-4111-8111-111111111111';

interface AuditLog {
  id: string;
  user: { id: string; fullName: string } | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  changes: Record<string, [unknown, unknown]> | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
}

interface AuditPage {
  data: AuditLog[];
  meta: { page: number; pageSize: number; total: number };
}

/**
 * Công ty A: admin (audit.view COMPANY), agent1 (AGENT, không có audit.view), `auditor` (vai trò riêng có
 * audit.view OWN). Nhật ký mẫu chèn thẳng với thời điểm cố định; công ty B có nhật ký riêng.
 */
describe('/api/v1/audit-logs', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let tenantA: string;
  let tenantB: string;
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

    const admin = await register('admin@a.vn');
    tenantA = admin.tenantId;
    userIds['admin'] = admin.userId;
    const auditorRole = await insertId(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'AUDITOR', 'Xem nhật ký của mình')`,
      [tenantA],
    );
    await db.query(
      `INSERT INTO role_permissions (role_id, permission_id, scope)
       SELECT $1, id, 'OWN' FROM permissions WHERE code = 'audit.view'`,
      [auditorRole],
    );
    const hash = await hashPassword(PASSWORD);
    for (const [name, role] of [
      ['agent1', 'AGENT'],
      ['auditor', 'AUDITOR'],
    ] as const) {
      userIds[name] = await insertUser(name, hash, role);
    }
    for (const name of Object.keys(userIds)) {
      tokens[name] = await login(`${name}@a.vn`);
    }
    const other = await register('admin@b.vn');
    tenantB = other.tenantId;
    userIds['otherAdmin'] = other.userId;
    tokens['otherAdmin'] = await login('admin@b.vn');

    await insertLog(
      tenantA,
      'agent1',
      'property.update',
      'property',
      ENTITY,
      '2026-10-01T03:00:00Z',
      {
        price: [3_000_000_000, 3_200_000_000],
      },
    );
    await insertLog(
      tenantA,
      'auditor',
      'customer.create',
      'customer',
      null,
      '2026-10-02T03:00:00Z',
    );
    await insertLog(
      tenantA,
      null,
      'appointment.remind',
      'appointment',
      null,
      '2026-10-03T03:00:00Z',
    );
    await insertLog(
      tenantB,
      'otherAdmin',
      'property.update',
      'property',
      ENTITY,
      '2026-10-04T03:00:00Z',
    );
  });

  after(async () => {
    await app.close();
  });

  async function insertId(sql: string, params: unknown[] = []): Promise<string> {
    const [row] = (await db.query(`${sql} RETURNING id`, params)) as { id: string }[];
    assert.ok(row);
    return row.id;
  }

  async function insertUser(name: string, hash: string, roleCode: string): Promise<string> {
    const id = await insertId(
      `INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, $4)`,
      [tenantA, `${name}@a.vn`, hash, name],
    );
    await db.query(
      `INSERT INTO user_roles (user_id, role_id, tenant_id)
       SELECT $1, id, tenant_id FROM roles WHERE tenant_id = $2 AND code = $3`,
      [id, tenantA, roleCode],
    );
    return id;
  }

  async function insertLog(
    tenantId: string,
    user: string | null,
    action: string,
    entityType: string,
    entityId: string | null,
    createdAt: string,
    changes: Record<string, unknown> | null = null,
  ): Promise<void> {
    await db.query(
      `INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, changes, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, '10.0.0.7', $7)`,
      [
        tenantId,
        user ? userIds[user] : null,
        action,
        entityType,
        entityId,
        changes === null ? null : JSON.stringify(changes),
        createdAt,
      ],
    );
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

  async function list(user: string, query = ''): Promise<AuditPage> {
    const response = await request('GET', `/audit-logs${query}`, undefined, tokens[user]);
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()) as AuditPage;
  }

  /** Nhật ký mẫu (bỏ nhật ký do đăng ký, đăng nhập sinh ra) theo thứ tự trả về. */
  function sampleActions(page: AuditPage): string[] {
    return page.data
      .filter((log) => log.createdAt < '2026-10-05')
      .map((log) => `${log.action}@${log.createdAt.slice(0, 10)}`);
  }

  it('admin xem nhật ký cả công ty, mới nhất trước, kèm tên người và thay đổi; không thấy công ty khác', async () => {
    const page = await list('admin', '?pageSize=100');
    assert.deepEqual(sampleActions(page), [
      'appointment.remind@2026-10-03',
      'customer.create@2026-10-02',
      'property.update@2026-10-01',
    ]);
    const update = page.data.find((log) => log.action === 'property.update');
    assert.ok(update);
    assert.deepEqual(update.user, { id: userIds['agent1'], fullName: 'agent1' });
    assert.deepEqual(update.changes, { price: [3_000_000_000, 3_200_000_000] });
    assert.equal(update.entityType, 'property');
    assert.equal(update.entityId, ENTITY);
    assert.equal(update.ipAddress, '10.0.0.7');
    assert.equal(page.data.find((log) => log.action === 'appointment.remind')?.user, null);
    assert.equal(page.meta.total, page.data.length);

    const other = await list('otherAdmin', '?pageSize=100');
    assert.deepEqual(sampleActions(other), ['property.update@2026-10-04']);
  });

  it('lọc theo loại, đối tượng, người, thao tác và khoảng thời gian', async () => {
    assert.deepEqual(sampleActions(await list('admin', '?entityType=customer')), [
      'customer.create@2026-10-02',
    ]);
    assert.deepEqual(sampleActions(await list('admin', `?entityId=${ENTITY}`)), [
      'property.update@2026-10-01',
    ]);
    assert.deepEqual(sampleActions(await list('admin', `?userId=${userIds['auditor']}`)), [
      'customer.create@2026-10-02',
    ]);
    assert.deepEqual(sampleActions(await list('admin', '?action=appointment.remind')), [
      'appointment.remind@2026-10-03',
    ]);
    const range = await list('admin', '?from=2026-10-02T00:00:00Z&to=2026-10-03T03:00:00Z');
    assert.deepEqual(sampleActions(range), ['customer.create@2026-10-02']);
    assert.equal(range.meta.total, 1);
  });

  it('phân trang theo pageSize', async () => {
    const page = await list('admin', '?entityType=property&pageSize=1&page=2');
    assert.equal(page.data.length, 0);
    assert.equal(page.meta.total, 1);
  });

  it('tham số sai → 400', async () => {
    for (const query of [
      '?from=2026-10-03T00:00:00Z&to=2026-10-02T00:00:00Z',
      '?entityType=Property;drop',
      '?entityId=x',
      '?userId=x',
      '?action=update',
      '?from=hôm-qua',
      '?foo=1',
    ]) {
      const response = await request('GET', `/audit-logs${query}`, undefined, tokens['admin']);
      assert.equal(response.status, 400, query);
    }
  });

  it('không có audit.view → 403; chưa đăng nhập → 401', async () => {
    assert.equal((await request('GET', '/audit-logs', undefined, tokens['agent1'])).status, 403);
    assert.equal((await request('GET', '/audit-logs')).status, 401);
  });

  it('audit.view OWN chỉ thấy nhật ký của chính mình', async () => {
    const page = await list('auditor', '?pageSize=100');
    assert.ok(page.data.length > 0);
    assert.ok(page.data.every((log) => log.user?.id === userIds['auditor']));
    assert.deepEqual(sampleActions(page), ['customer.create@2026-10-02']);
  });

  it('thao tác thật qua API có trong nhật ký', async () => {
    const response = await request(
      'POST',
      '/customers',
      { fullName: 'Khách thử nhật ký', phone: '+84901234567' },
      tokens['admin'],
    );
    assert.equal(response.status, 201);
    const customer = ((await response.json()) as { data: { id: string } }).data;
    const page = await list('admin', `?entityType=customer&entityId=${customer.id}`);
    assert.equal(page.data.length, 1);
    assert.equal(page.data[0]?.action, 'customer.create');
    assert.equal(page.data[0]?.user?.id, userIds['admin']);
  });
});
