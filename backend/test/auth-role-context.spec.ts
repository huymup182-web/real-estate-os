import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { Controller, Get, type INestApplication, Module, Req } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { AppModule } from '../src/app.module.js';
import { DEFAULT_ROLE_MATRIX } from '../src/auth/default-roles.js';
import type { AuthenticatedRequest } from '../src/auth/jwt-auth.guard.js';
import { hashPassword } from '../src/auth/password.js';
import { PermissionService } from '../src/auth/permission.service.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

/** Route cần đăng nhập, chỉ dùng cho test: trả lại req.user. */
@Controller('test-role-context')
class RoleContextController {
  @Get()
  me(@Req() req: AuthenticatedRequest): unknown {
    return req.user;
  }
}

@Module({ imports: [AppModule], controllers: [RoleContextController] })
class TestAppModule {}

interface RequestUserBody {
  userId: string;
  roles: string[];
  permissions: Record<string, string>;
}

describe('Nạp role và quyền vào request (TASK-045)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let permissionService: PermissionService;
  let companyId: string;
  let agentId: string;
  let agentToken: string;

  before(async () => {
    await useTestDatabase();
    app = await createApp(TestAppModule);
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    db = app.get(DataSource);
    permissionService = app.get(PermissionService);

    const registered = await post('/auth/register', {
      companyName: 'Công ty Role',
      fullName: 'Admin Role',
      email: 'role-admin@test.vn',
      password: PASSWORD,
    });
    assert.equal(registered.status, 201);
    companyId = ((await registered.json()) as { data: { company: { id: string } } }).data.company
      .id;

    const [agent] = (await db.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1, 'role-agent@test.vn', $2, 'Môi giới') RETURNING id`,
      [companyId, await hashPassword(PASSWORD)],
    )) as { id: string }[];
    assert.ok(agent);
    agentId = agent.id;
    await setRoles(agentId, ['AGENT']);
    agentToken = await login('role-agent@test.vn');
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

  async function login(email: string): Promise<string> {
    const response = await post('/auth/login', { identifier: email, password: PASSWORD });
    assert.equal(response.status, 200);
    return ((await response.json()) as { data: { accessToken: string } }).data.accessToken;
  }

  async function setRoles(userId: string, roleCodes: string[]): Promise<void> {
    await db.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    await db.query(
      `INSERT INTO user_roles (user_id, role_id, tenant_id)
       SELECT $1, id, tenant_id FROM roles WHERE tenant_id = $2 AND code = ANY($3::text[])`,
      [userId, companyId, roleCodes],
    );
  }

  async function requestUser(token: string): Promise<RequestUserBody> {
    const response = await fetch(`${baseUrl}/test-role-context`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    return ((await response.json()) as { data: RequestUserBody }).data;
  }

  it('req.user có role và quyền hiệu lực (permission → scope) của user', async () => {
    permissionService.invalidate();
    const user = await requestUser(agentToken);
    assert.equal(user.userId, agentId);
    assert.deepEqual(user.roles, ['AGENT']);
    const expected = Object.fromEntries(
      Object.entries(DEFAULT_ROLE_MATRIX)
        .map(([code, scopes]) => [code, scopes[4]] as const)
        .filter(([, scope]) => scope !== null && scope !== undefined),
    );
    assert.deepEqual(user.permissions, expected);
    assert.equal(user.permissions['property.edit'], 'OWN');
    assert.equal(user.permissions['user.manage'], undefined, 'AGENT không có user.manage');
  });

  it('dùng cache: đổi role trong DB chưa có hiệu lực tới khi invalidate', async () => {
    permissionService.invalidate();
    assert.deepEqual((await requestUser(agentToken)).roles, ['AGENT']);
    await setRoles(agentId, ['AGENT', 'TEAM_LEADER']);
    try {
      assert.deepEqual((await requestUser(agentToken)).roles, ['AGENT'], 'vẫn lấy từ cache');

      permissionService.invalidate(agentId);
      const user = await requestUser(agentToken);
      assert.deepEqual(user.roles, ['AGENT', 'TEAM_LEADER']);
      assert.equal(user.permissions['property.edit'], 'TEAM', 'scope rộng nhất thắng');
    } finally {
      await setRoles(agentId, ['AGENT']);
      permissionService.invalidate();
    }
  });

  it('user không có role → danh sách role và quyền rỗng', async () => {
    await setRoles(agentId, []);
    permissionService.invalidate(agentId);
    try {
      const user = await requestUser(agentToken);
      assert.deepEqual(user.roles, []);
      assert.deepEqual(user.permissions, {});
    } finally {
      await setRoles(agentId, ['AGENT']);
      permissionService.invalidate(agentId);
    }
  });

  it('route công khai không nạp quyền và không cần token', async () => {
    assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/test-role-context`)).status, 401);
  });
});
