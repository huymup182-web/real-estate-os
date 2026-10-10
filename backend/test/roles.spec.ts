import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { DEFAULT_ROLE_MATRIX } from '../src/auth/default-roles.js';
import { hashPassword } from '../src/auth/password.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionsLocked: boolean;
  userCount: number;
  permissionCount: number;
  permissions?: { code: string; scope: string }[];
}

interface ApiError {
  error: { code: string; details?: { field?: string; message: string }[] };
}

/** Công ty A: admin (COMPANY_ADMIN), hr (role HR: admin.manage + user.view COMPANY), agent1. Công ty B: adminB. */
describe('/api/v1/roles', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let tenantA: string;
  const tokens: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  const roleIds: Record<string, string> = {};

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
    const hrRole = await insertId(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'HR', 'Nhân sự')`,
      [tenantA],
    );
    await db.query(
      `INSERT INTO role_permissions (role_id, permission_id, scope)
       SELECT $1, id, 'COMPANY' FROM permissions WHERE code IN ('admin.manage', 'user.view')`,
      [hrRole],
    );
    for (const row of (await db.query(`SELECT id, code FROM roles WHERE tenant_id = $1`, [
      tenantA,
    ])) as { id: string; code: string }[]) {
      roleIds[row.code] = row.id;
    }
    const hash = await hashPassword(PASSWORD);
    for (const [name, role] of [
      ['hr', 'HR'],
      ['agent1', 'AGENT'],
    ] as const) {
      const id = await insertId(
        `INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, $4)`,
        [tenantA, `${name}@a.vn`, hash, name],
      );
      await db.query(`INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)`, [
        id,
        roleIds[role],
        tenantA,
      ]);
      userIds[name] = id;
    }
    for (const name of ['admin', 'hr', 'agent1']) {
      tokens[name] = await login(`${name}@a.vn`);
    }
    await register('admin@b.vn');
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

  it('danh sách: role mặc định trước, kèm số người dùng và số quyền; chỉ COMPANY_ADMIN bị khoá quyền', async () => {
    const roles = await ok<Role[]>(await as('admin', 'GET', '/roles'));
    assert.equal(roles.length, 7);
    assert.deepEqual(roles.filter((role) => role.isSystem).length, 6);
    assert.equal(roles.at(-1)?.code, 'HR');
    const byCode = new Map(roles.map((role) => [role.code, role]));
    assert.equal(byCode.get('COMPANY_ADMIN')?.userCount, 1);
    assert.equal(byCode.get('AGENT')?.userCount, 1);
    assert.equal(byCode.get('DIRECTOR')?.userCount, 0);
    assert.equal(
      byCode.get('AGENT')?.permissionCount,
      Object.values(DEFAULT_ROLE_MATRIX).filter((scopes) => scopes[4]).length,
    );
    assert.deepEqual(
      roles.filter((role) => role.permissionsLocked).map((role) => role.code),
      ['COMPANY_ADMIN'],
    );
  });

  it('danh mục quyền không có quyền nền tảng', async () => {
    const catalog = await ok<{ code: string; module: string }[]>(
      await as('admin', 'GET', '/roles/permissions'),
    );
    assert.ok(catalog.some((permission) => permission.code === 'property.view'));
    assert.ok(catalog.every((permission) => !permission.code.startsWith('platform.')));
    assert.ok(catalog.every((permission) => permission.code.startsWith(`${permission.module}.`)));
  });

  it('không có admin.manage → 403; công ty khác → 404', async () => {
    await errorOf(await as('agent1', 'GET', '/roles'), 403);
    await errorOf(
      await as('agent1', 'POST', '/roles', { code: 'X', name: 'X', permissions: [] }),
      403,
    );
    await errorOf(await as('adminB', 'GET', `/roles/${roleIds['HR']}`), 404);
  });

  it('tạo vai trò: mã viết hoa, lưu quyền, ghi nhật ký; trùng mã → 409', async () => {
    const created = await ok<Role>(
      await as('admin', 'POST', '/roles', {
        code: ' sale_lead ',
        name: ' Trưởng kinh doanh ',
        description: 'Quản lý nhóm bán hàng',
        permissions: [
          { code: 'property.view', scope: 'COMPANY' },
          { code: 'customer.view', scope: 'TEAM' },
        ],
      }),
      201,
    );
    roleIds['SALE_LEAD'] = created.id;
    assert.equal(created.code, 'SALE_LEAD');
    assert.equal(created.name, 'Trưởng kinh doanh');
    assert.equal(created.isSystem, false);
    assert.deepEqual(created.permissions, [
      { code: 'customer.view', scope: 'TEAM' },
      { code: 'property.view', scope: 'COMPANY' },
    ]);
    const [changes] = await auditChanges('role.create', created.id);
    assert.deepEqual(changes?.['permissions'], [
      null,
      ['customer.view:TEAM', 'property.view:COMPANY'],
    ]);

    const duplicate = await errorOf(
      await as('admin', 'POST', '/roles', { code: 'SALE_LEAD', name: 'Khác', permissions: [] }),
      409,
    );
    assert.equal(duplicate.details?.[0]?.field, 'code');
  });

  it('dữ liệu sai → 400: mã sai, quyền lạ, quyền nền tảng, trùng quyền, phạm vi PLATFORM', async () => {
    const base = { code: 'NEW_ROLE', name: 'Mới', permissions: [] as unknown[] };
    for (const payload of [
      { ...base, code: '1ABC' },
      { ...base, name: '' },
      { ...base, permissions: [{ code: 'property.fly', scope: 'OWN' }] },
      { ...base, permissions: [{ code: 'platform.company.manage', scope: 'COMPANY' }] },
      {
        ...base,
        permissions: [
          { code: 'property.view', scope: 'OWN' },
          { code: 'property.view', scope: 'TEAM' },
        ],
      },
      { ...base, permissions: [{ code: 'property.view', scope: 'PLATFORM' }] },
    ]) {
      await errorOf(await as('admin', 'POST', '/roles', payload), 400);
    }
  });

  it('không cấp được quyền vượt quyền của mình', async () => {
    const escalation = await errorOf(
      await as('hr', 'POST', '/roles', {
        code: 'VIEWER',
        name: 'Xem',
        permissions: [{ code: 'property.view', scope: 'OWN' }],
      }),
      403,
    );
    assert.equal(escalation.code, 'FORBIDDEN');
    await ok<Role>(
      await as('hr', 'POST', '/roles', {
        code: 'USER_VIEWER',
        name: 'Xem người dùng',
        permissions: [{ code: 'user.view', scope: 'DEPARTMENT' }],
      }),
      201,
    );
    // hr sửa role của chính mình để tự thêm quyền cũng bị chặn.
    await errorOf(
      await as('hr', 'PATCH', `/roles/${roleIds['HR']}`, {
        permissions: [
          { code: 'admin.manage', scope: 'COMPANY' },
          { code: 'user.view', scope: 'COMPANY' },
          { code: 'user.manage', scope: 'COMPANY' },
        ],
      }),
      403,
    );
  });

  it('sửa quyền của role có hiệu lực ngay với người đang có role đó', async () => {
    const assign = await as('admin', 'PATCH', `/users/${userIds['agent1']}`, {
      roleIds: [roleIds['AGENT'], roleIds['SALE_LEAD']],
    });
    assert.equal(assign.status, 200);
    await errorOf(await as('agent1', 'GET', '/users'), 403);

    const updated = await ok<Role>(
      await as('admin', 'PATCH', `/roles/${roleIds['SALE_LEAD']}`, {
        name: 'Trưởng kinh doanh mới',
        description: '',
        permissions: [
          { code: 'property.view', scope: 'COMPANY' },
          { code: 'user.view', scope: 'COMPANY' },
        ],
      }),
    );
    assert.equal(updated.name, 'Trưởng kinh doanh mới');
    assert.equal(updated.description, null);
    assert.equal(updated.userCount, 1);
    assert.equal((await as('agent1', 'GET', '/users')).status, 200);

    await ok<Role>(
      await as('admin', 'PATCH', `/roles/${roleIds['SALE_LEAD']}`, {
        permissions: [{ code: 'property.view', scope: 'COMPANY' }],
      }),
    );
    await errorOf(await as('agent1', 'GET', '/users'), 403);
    const changes = await auditChanges('role.update', roleIds['SALE_LEAD'] ?? '');
    assert.deepEqual(changes[0]?.['name'], ['Trưởng kinh doanh', 'Trưởng kinh doanh mới']);
    assert.deepEqual(changes[1]?.['permissions'], [
      ['property.view:COMPANY', 'user.view:COMPANY'],
      ['property.view:COMPANY'],
    ]);
  });

  it('quyền của Quản trị công ty bị khoá, vẫn đổi được tên; role mặc định khác sửa được quyền', async () => {
    const locked = await errorOf(
      await as('admin', 'PATCH', `/roles/${roleIds['COMPANY_ADMIN']}`, {
        permissions: [{ code: 'property.view', scope: 'COMPANY' }],
      }),
      422,
    );
    assert.equal(locked.code, 'BUSINESS_RULE_VIOLATION');
    const renamed = await ok<Role>(
      await as('admin', 'PATCH', `/roles/${roleIds['COMPANY_ADMIN']}`, { name: 'Quản trị viên' }),
    );
    assert.equal(renamed.name, 'Quản trị viên');
    const agent = await ok<Role>(
      await as('admin', 'PATCH', `/roles/${roleIds['AGENT']}`, {
        permissions: [{ code: 'property.view', scope: 'COMPANY' }],
      }),
    );
    assert.equal(agent.permissionCount, 1);
  });

  it('xoá: role mặc định hoặc còn người dùng → 422; role trống xoá được và dùng lại được mã', async () => {
    await errorOf(await as('admin', 'DELETE', `/roles/${roleIds['DIRECTOR']}`), 422);
    const inUse = await errorOf(await as('admin', 'DELETE', `/roles/${roleIds['SALE_LEAD']}`), 422);
    assert.equal(inUse.code, 'BUSINESS_RULE_VIOLATION');

    await as('admin', 'PATCH', `/users/${userIds['agent1']}`, { roleIds: [roleIds['AGENT']] });
    const removed = await as('admin', 'DELETE', `/roles/${roleIds['SALE_LEAD']}`);
    assert.equal(removed.status, 204);
    await errorOf(await as('admin', 'GET', `/roles/${roleIds['SALE_LEAD']}`), 404);
    const roles = await ok<Role[]>(await as('admin', 'GET', '/roles'));
    assert.equal(
      roles.some((role) => role.code === 'SALE_LEAD'),
      false,
    );
    assert.equal((await auditChanges('role.delete', roleIds['SALE_LEAD'] ?? '')).length, 1);
    await ok<Role>(
      await as('admin', 'POST', '/roles', { code: 'SALE_LEAD', name: 'Lại', permissions: [] }),
      201,
    );
  });
});
