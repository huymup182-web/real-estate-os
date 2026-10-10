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

interface Company {
  id: string;
  name: string;
  slug: string;
  status: string;
  settings: { verifyIntervalDays: number; verifyIntervalDaysDefault: number };
  stats: { users: number; departments: number; teams: number };
}

interface Department {
  id: string;
  name: string;
  manager: { id: string; fullName: string } | null;
  userCount: number;
  teamCount: number;
}

interface ApiError {
  error: { code: string; details?: { field?: string; message: string }[] };
}

/** Công ty A: admin (COMPANY_ADMIN), agent1 (AGENT), quit (AGENT, INACTIVE). Công ty B: adminB. */
describe('/api/v1/company và /api/v1/departments', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let tenantA: string;
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
    const [agentRole] = (await db.query(
      `SELECT id FROM roles WHERE tenant_id = $1 AND code = 'AGENT'`,
      [tenantA],
    )) as { id: string }[];
    const hash = await hashPassword(PASSWORD);
    for (const [name, status] of [
      ['agent1', 'ACTIVE'],
      ['quit', 'INACTIVE'],
    ] as const) {
      const id = await insertId(
        `INSERT INTO users (tenant_id, email, password_hash, full_name, status)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantA, `${name}@a.vn`, hash, name, status],
      );
      await db.query(`INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)`, [
        id,
        agentRole?.id,
        tenantA,
      ]);
      userIds[name] = id;
    }
    tokens['admin'] = await login('admin@a.vn');
    tokens['agent1'] = await login('agent1@a.vn');
    const adminB = await register('admin@b.vn');
    userIds['adminB'] = adminB.userId;
    tokens['adminB'] = await login('admin@b.vn');
  });

  after(async () => {
    await app.close();
  });

  async function insertId(sql: string, params: unknown[] = []): Promise<string> {
    const [row] = (await db.query(`${sql} RETURNING id`, params)) as { id: string }[];
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

  const as = (user: string, method: string, path: string, payload?: unknown): Promise<Response> =>
    request(method, path, payload, tokens[user]);

  async function ok<T>(response: Response, status = 200): Promise<T> {
    assert.equal(response.status, status, await response.clone().text());
    return ((await response.json()) as { data: T }).data;
  }

  async function errorOf(response: Response, status: number): Promise<ApiError['error']> {
    assert.equal(response.status, status, await response.clone().text());
    return ((await response.json()) as ApiError).error;
  }

  async function auditChanges(action: string, id: string): Promise<Record<string, unknown>[]> {
    const rows = (await db.query(
      `SELECT changes FROM audit_logs WHERE action = $1 AND entity_id = $2 ORDER BY created_at`,
      [action, id],
    )) as { changes: Record<string, unknown> }[];
    return rows.map((row) => row.changes);
  }

  it('xem công ty: thông tin, chu kỳ xác minh mặc định, số liệu; cần admin.manage', async () => {
    const company = await ok<Company>(await as('admin', 'GET', '/company'));
    assert.equal(company.id, tenantA);
    assert.equal(company.name, 'Công ty admin@a.vn');
    assert.equal(company.status, 'ACTIVE');
    assert.ok(company.slug);
    assert.deepEqual(company.settings, { verifyIntervalDays: 30, verifyIntervalDaysDefault: 30 });
    assert.deepEqual(company.stats, { users: 3, departments: 0, teams: 0 });

    assert.equal((await as('agent1', 'GET', '/company')).status, 403);
    assert.equal((await request('GET', '/company')).status, 401);
    assert.equal((await as('agent1', 'GET', '/departments')).status, 403);
    assert.equal((await as('agent1', 'GET', '/departments/manager-options')).status, 403);

    // Chỉ người dùng đang hoạt động của công ty mới chọn làm trưởng phòng được.
    const managers = await ok<{ id: string; fullName: string }[]>(
      await as('admin', 'GET', '/departments/manager-options'),
    );
    assert.deepEqual(
      managers.map((user) => user.id).sort(),
      [userIds['admin'], userIds['agent1']].sort(),
    );
    assert.equal((await as('agent1', 'POST', '/departments', { name: 'X' })).status, 403);
  });

  it('sửa tên và chu kỳ xác minh: giữ cài đặt khác, ghi nhật ký, công ty khác không đổi', async () => {
    await db.query(`UPDATE companies SET settings = settings || '{"other": true}' WHERE id = $1`, [
      tenantA,
    ]);
    const updated = await ok<Company>(
      await as('admin', 'PATCH', '/company', { name: '  Công ty Mới  ', verifyIntervalDays: 14 }),
    );
    assert.equal(updated.name, 'Công ty Mới');
    assert.equal(updated.settings.verifyIntervalDays, 14);
    const [row] = (await db.query(`SELECT settings FROM companies WHERE id = $1`, [tenantA])) as {
      settings: Record<string, unknown>;
    }[];
    assert.deepEqual(row?.settings, { other: true, verify_interval_days: 14 });
    assert.deepEqual(await auditChanges('company.update', tenantA), [
      {
        name: ['Công ty admin@a.vn', 'Công ty Mới'],
        verifyIntervalDays: [30, 14],
      },
    ]);

    // Không đổi gì thì không ghi nhật ký.
    await ok<Company>(await as('admin', 'PATCH', '/company', { verifyIntervalDays: 14 }));
    assert.equal((await auditChanges('company.update', tenantA)).length, 1);

    const me = await ok<{ company: { name: string } }>(await as('admin', 'GET', '/auth/me'));
    assert.equal(me.company.name, 'Công ty Mới');
    const other = await ok<Company>(await as('adminB', 'GET', '/company'));
    assert.equal(other.name, 'Công ty admin@b.vn');
    assert.equal(other.settings.verifyIntervalDays, 30);
  });

  it('dữ liệu công ty sai → 400; không đổi được slug, trạng thái', async () => {
    for (const payload of [
      { name: '   ' },
      { name: '<b>X</b>' },
      { name: 'x'.repeat(256) },
      { verifyIntervalDays: 0 },
      { verifyIntervalDays: 366 },
      { verifyIntervalDays: 1.5 },
      { verifyIntervalDays: '7' },
      { slug: 'moi' },
      { status: 'SUSPENDED' },
    ]) {
      const error = await errorOf(await as('admin', 'PATCH', '/company', payload), 400);
      assert.equal(error.code, 'VALIDATION_ERROR', JSON.stringify(payload));
    }
  });

  it('tạo, sửa phòng ban: tên không trùng, trưởng phòng phải đang hoạt động trong công ty', async () => {
    const sales = await ok<Department>(
      await as('admin', 'POST', '/departments', {
        name: ' Kinh doanh ',
        managerId: userIds['agent1'],
      }),
      201,
    );
    assert.equal(sales.name, 'Kinh doanh');
    assert.deepEqual(sales.manager, { id: userIds['agent1'], fullName: 'agent1' });
    assert.equal(sales.userCount, 0);
    assert.deepEqual(await auditChanges('department.create', sales.id), [
      { name: [null, 'Kinh doanh'], managerId: [null, userIds['agent1']] },
    ]);

    const dup = await errorOf(
      await as('admin', 'POST', '/departments', { name: 'Kinh doanh' }),
      409,
    );
    assert.equal(dup.details?.[0]?.field, 'name');
    for (const managerId of [
      userIds['quit'],
      userIds['adminB'],
      '00000000-0000-4000-8000-000000000000',
    ]) {
      const error = await errorOf(
        await as('admin', 'POST', '/departments', { name: 'Marketing', managerId }),
        400,
      );
      assert.equal(error.details?.[0]?.field, 'managerId');
    }
    for (const payload of [
      {},
      { name: '' },
      { name: '<i>x</i>' },
      { name: 'X', managerId: 'abc' },
    ]) {
      assert.equal((await as('admin', 'POST', '/departments', payload)).status, 400);
    }

    const marketing = await ok<Department>(
      await as('admin', 'POST', '/departments', { name: 'Marketing' }),
      201,
    );
    assert.equal(marketing.manager, null);
    const renameDup = await errorOf(
      await as('admin', 'PATCH', `/departments/${marketing.id}`, { name: 'Kinh doanh' }),
      409,
    );
    assert.equal(renameDup.details?.[0]?.field, 'name');

    const updated = await ok<Department>(
      await as('admin', 'PATCH', `/departments/${sales.id}`, {
        name: 'Kinh doanh 1',
        managerId: null,
      }),
    );
    assert.equal(updated.name, 'Kinh doanh 1');
    assert.equal(updated.manager, null);
    assert.deepEqual(await auditChanges('department.update', sales.id), [
      { name: ['Kinh doanh', 'Kinh doanh 1'], managerId: [userIds['agent1'], null] },
    ]);
    // Đổi lại đúng tên cũ của chính nó không bị coi là trùng.
    await ok<Department>(
      await as('admin', 'PATCH', `/departments/${sales.id}`, { name: 'Kinh doanh 1' }),
    );

    const list = await ok<Department[]>(await as('admin', 'GET', '/departments'));
    assert.deepEqual(
      list.map((department) => department.name),
      ['Kinh doanh 1', 'Marketing'],
    );
    const company = await ok<Company>(await as('admin', 'GET', '/company'));
    assert.equal(company.stats.departments, 2);
  });

  it('phòng ban công ty khác → 404', async () => {
    const own = await ok<Department>(
      await as('adminB', 'POST', '/departments', { name: 'Phòng B' }),
      201,
    );
    assert.equal((await as('admin', 'GET', `/departments/${own.id}`)).status, 404);
    assert.equal(
      (await as('admin', 'PATCH', `/departments/${own.id}`, { name: 'Đổi' })).status,
      404,
    );
    assert.equal((await as('admin', 'DELETE', `/departments/${own.id}`)).status, 404);
    assert.equal((await as('admin', 'GET', '/departments/abc')).status, 400);
    const list = await ok<Department[]>(await as('admin', 'GET', '/departments'));
    assert.ok(!list.some((department) => department.id === own.id));
  });

  it('xoá phòng ban: còn người dùng hoặc team → 422; trống thì xoá mềm và dùng lại được tên', async () => {
    const dept = await ok<Department>(
      await as('admin', 'POST', '/departments', { name: 'Tạm thời' }),
      201,
    );
    await db.query(`UPDATE users SET department_id = $1 WHERE id = $2`, [
      dept.id,
      userIds['agent1'],
    ]);
    const withUser = await ok<Department>(await as('admin', 'GET', `/departments/${dept.id}`));
    assert.equal(withUser.userCount, 1);
    const blocked = await errorOf(await as('admin', 'DELETE', `/departments/${dept.id}`), 422);
    assert.equal(blocked.code, 'BUSINESS_RULE_VIOLATION');

    await db.query(`UPDATE users SET department_id = NULL WHERE id = $1`, [userIds['agent1']]);
    const teamId = await insertId(
      `INSERT INTO teams (tenant_id, department_id, name) VALUES ($1, $2, 'Team 1')`,
      [tenantA, dept.id],
    );
    const withTeam = await ok<Department>(await as('admin', 'GET', `/departments/${dept.id}`));
    assert.equal(withTeam.teamCount, 1);
    await errorOf(await as('admin', 'DELETE', `/departments/${dept.id}`), 422);

    await db.query(`UPDATE teams SET deleted_at = now() WHERE id = $1`, [teamId]);
    assert.equal((await as('admin', 'DELETE', `/departments/${dept.id}`)).status, 204);
    assert.equal((await as('admin', 'GET', `/departments/${dept.id}`)).status, 404);
    const [row] = (await db.query(`SELECT deleted_at FROM departments WHERE id = $1`, [
      dept.id,
    ])) as {
      deleted_at: Date | null;
    }[];
    assert.ok(row?.deleted_at);
    assert.deepEqual(await auditChanges('department.delete', dept.id), [
      { name: ['Tạm thời', null] },
    ]);
    await ok<Department>(await as('admin', 'POST', '/departments', { name: 'Tạm thời' }), 201);
  });
});
