import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { DEFAULT_ROLE_MATRIX, DEFAULT_ROLES } from '../src/auth/default-roles.js';
import { hashPassword } from '../src/auth/password.js';
import { PERMISSION_SCOPES } from '../src/auth/permission.service.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

interface MeData {
  user: Record<string, unknown>;
  company: { id: string; name: string; slug: string } | null;
  roles: { code: string; name: string }[];
  permissions: { code: string; scope: string }[];
}

/** Quyền hiệu lực tính từ ma trận mặc định: hợp các role, mỗi quyền lấy scope rộng nhất. */
function expectedPermissions(roleCodes: string[]): { code: string; scope: string }[] {
  const columns = roleCodes.map((code) => DEFAULT_ROLES.findIndex(([role]) => role === code));
  const result: { code: string; scope: string }[] = [];
  for (const [code, scopes] of Object.entries(DEFAULT_ROLE_MATRIX)) {
    let widest: string | null = null;
    for (const column of columns) {
      const scope = scopes[column] ?? null;
      if (
        scope !== null &&
        (widest === null ||
          PERMISSION_SCOPES.indexOf(scope) >
            PERMISSION_SCOPES.indexOf(widest as (typeof PERMISSION_SCOPES)[number]))
      ) {
        widest = scope;
      }
    }
    if (widest !== null) {
      result.push({ code, scope: widest });
    }
  }
  return result.sort((a, b) => (a.code < b.code ? -1 : 1));
}

describe('GET /api/v1/auth/me', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let adminId: string;
  let companyId: string;

  before(async () => {
    await useTestDatabase();
    app = await createApp();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1/auth`;
    db = app.get(DataSource);

    const registered = await post('/register', {
      companyName: 'Công ty Tôi Là Ai',
      fullName: 'Admin Me',
      email: 'me@test.vn',
      phone: '+84903000001',
      password: PASSWORD,
    });
    assert.equal(registered.status, 201);
    const data = (
      (await registered.json()) as {
        data: { user: { id: string }; company: { id: string } };
      }
    ).data;
    adminId = data.user.id;
    companyId = data.company.id;
  });

  after(async () => {
    await app.close();
  });

  function post(path: string, payload: unknown): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async function accessToken(identifier: string): Promise<string> {
    const response = await post('/login', { identifier, password: PASSWORD });
    assert.equal(response.status, 200, identifier);
    return ((await response.json()) as { data: { accessToken: string } }).data.accessToken;
  }

  async function me(token?: string): Promise<{ status: number; data: MeData; code?: string }> {
    const response = await fetch(`${baseUrl}/me`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    const body = (await response.json()) as { data: MeData; error?: { code: string } };
    return { status: response.status, data: body.data, code: body.error?.code };
  }

  async function insertUser(email: string, tenantId: string | null): Promise<string> {
    const [row] = (await db.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1, $2, $3, 'Người dùng') RETURNING id`,
      [tenantId, email, await hashPassword(PASSWORD)],
    )) as { id: string }[];
    assert.ok(row);
    return row.id;
  }

  async function assignRoles(userId: string, roleCodes: string[]): Promise<void> {
    await db.query(
      `INSERT INTO user_roles (user_id, role_id, tenant_id)
       SELECT $1, id, tenant_id FROM roles WHERE tenant_id = $2 AND code = ANY($3::text[])`,
      [userId, companyId, roleCodes],
    );
  }

  it('admin công ty → user, công ty, role và đủ permission theo ma trận', async () => {
    const result = await me(await accessToken('me@test.vn'));
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.user, {
      id: adminId,
      tenantId: companyId,
      fullName: 'Admin Me',
      email: 'me@test.vn',
      phone: '+84903000001',
      avatarUrl: null,
      departmentId: null,
      status: 'ACTIVE',
    });
    assert.equal(result.data.company?.id, companyId);
    assert.equal(result.data.company?.name, 'Công ty Tôi Là Ai');
    assert.deepEqual(result.data.roles, [{ code: 'COMPANY_ADMIN', name: 'Quản trị công ty' }]);
    assert.deepEqual(result.data.permissions, expectedPermissions(['COMPANY_ADMIN']));
  });

  it('nhiều role → hợp các permission, mỗi permission lấy scope rộng nhất', async () => {
    const userId = await insertUser('multi@test.vn', companyId);
    await assignRoles(userId, ['AGENT', 'TEAM_LEADER']);
    const result = await me(await accessToken('multi@test.vn'));
    assert.equal(result.status, 200);
    assert.deepEqual(
      result.data.roles.map((role) => role.code),
      ['AGENT', 'TEAM_LEADER'],
    );
    const expected = expectedPermissions(['AGENT', 'TEAM_LEADER']);
    assert.deepEqual(result.data.permissions, expected);
    // AGENT sửa BĐS phạm vi OWN, TEAM_LEADER phạm vi TEAM → TEAM thắng.
    assert.deepEqual(
      result.data.permissions.find((p) => p.code === 'property.edit'),
      { code: 'property.edit', scope: 'TEAM' },
    );
  });

  it('role đã xoá mềm không còn tính quyền', async () => {
    const userId = await insertUser('deleted-role@test.vn', companyId);
    await assignRoles(userId, ['MANAGER']);
    const token = await accessToken('deleted-role@test.vn');
    await db.query(
      `UPDATE roles SET deleted_at = now() WHERE tenant_id = $1 AND code = 'MANAGER'`,
      [companyId],
    );
    try {
      const result = await me(token);
      assert.equal(result.status, 200);
      assert.deepEqual(result.data.roles, []);
      assert.deepEqual(result.data.permissions, []);
    } finally {
      await db.query(
        `UPDATE roles SET deleted_at = NULL WHERE tenant_id = $1 AND code = 'MANAGER'`,
        [companyId],
      );
    }
  });

  it('tài khoản nền tảng không có công ty, không có role → company null, danh sách rỗng', async () => {
    await insertUser('platform-me@test.vn', null);
    const result = await me(await accessToken('platform-me@test.vn'));
    assert.equal(result.status, 200);
    assert.equal(result.data.company, null);
    assert.equal(result.data.user['tenantId'], null);
    assert.deepEqual(result.data.roles, []);
    assert.deepEqual(result.data.permissions, []);
  });

  it('không có token → 401; user bị khoá hoặc công ty tạm ngưng → 403; user đã xoá → 401', async () => {
    const missing = await me();
    assert.equal(missing.status, 401);
    assert.equal(missing.code, 'UNAUTHENTICATED');

    const token = await accessToken('me@test.vn');
    const cases: [string, string, string, number][] = [
      [
        `UPDATE users SET status = 'LOCKED' WHERE id = $1`,
        `UPDATE users SET status = 'ACTIVE' WHERE id = $1`,
        adminId,
        403,
      ],
      [
        `UPDATE companies SET status = 'SUSPENDED' WHERE id = $1`,
        `UPDATE companies SET status = 'ACTIVE' WHERE id = $1`,
        companyId,
        403,
      ],
      [
        `UPDATE users SET deleted_at = now() WHERE id = $1`,
        `UPDATE users SET deleted_at = NULL WHERE id = $1`,
        adminId,
        401,
      ],
    ];
    for (const [apply, restore, id, status] of cases) {
      await db.query(apply, [id]);
      try {
        assert.equal((await me(token)).status, status, apply);
      } finally {
        await db.query(restore, [id]);
      }
    }
    assert.equal((await me(token)).status, 200);
  });
});
