import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { Controller, Get, type INestApplication, Module } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { AppModule } from '../src/app.module.js';
import { hashPassword } from '../src/auth/password.js';
import { GrantedScope, RequirePermission } from '../src/auth/permission.guard.js';
import type { PermissionScope } from '../src/auth/permission.service.js';
import { Public } from '../src/auth/public.decorator.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

/** Các route chỉ dùng cho test. */
@Controller('test-permission')
class PermissionTestController {
  @Get('property-delete')
  @RequirePermission('property.delete')
  propertyDelete(@GrantedScope() scope: PermissionScope): { scope: PermissionScope } {
    return { scope };
  }

  @Get('property-edit')
  @RequirePermission('property.edit')
  propertyEdit(@GrantedScope() scope: PermissionScope): { scope: PermissionScope } {
    return { scope };
  }

  @Get('unknown')
  @RequirePermission('khong.ton_tai')
  unknown(): string {
    return 'ok';
  }

  @Get('no-permission')
  noPermission(): string {
    return 'ok';
  }

  @Public()
  @Get('public-with-permission')
  @RequirePermission('property.view')
  publicWithPermission(): string {
    return 'ok';
  }
}

/** Quyền đặt ở controller, handler ghi đè được. */
@Controller('test-permission-class')
@RequirePermission('audit.view')
class ClassPermissionTestController {
  @Get()
  fromClass(@GrantedScope() scope: PermissionScope): { scope: PermissionScope } {
    return { scope };
  }

  @Get('override')
  @RequirePermission('customer.create')
  override(@GrantedScope() scope: PermissionScope): { scope: PermissionScope } {
    return { scope };
  }
}

@Module({
  imports: [AppModule],
  controllers: [PermissionTestController, ClassPermissionTestController],
})
class TestAppModule {}

describe('PermissionGuard (TASK-046)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let companyId: string;
  const tokens: Record<string, string> = {};

  before(async () => {
    await useTestDatabase();
    app = await createApp(TestAppModule);
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    db = app.get(DataSource);

    const registered = await post('/auth/register', {
      companyName: 'Công ty Phân Quyền',
      fullName: 'Admin',
      email: 'perm-admin@test.vn',
      password: PASSWORD,
    });
    assert.equal(registered.status, 201);
    companyId = ((await registered.json()) as { data: { company: { id: string } } }).data.company
      .id;
    tokens['COMPANY_ADMIN'] = await login('perm-admin@test.vn');

    for (const role of ['MANAGER', 'AGENT']) {
      const email = `perm-${role.toLowerCase()}@test.vn`;
      const [user] = (await db.query(
        `INSERT INTO users (tenant_id, email, password_hash, full_name)
         VALUES ($1, $2, $3, 'Nhân viên') RETURNING id`,
        [companyId, email, await hashPassword(PASSWORD)],
      )) as { id: string }[];
      assert.ok(user);
      await db.query(
        `INSERT INTO user_roles (user_id, role_id, tenant_id)
         SELECT $1, id, tenant_id FROM roles WHERE tenant_id = $2 AND code = $3`,
        [user.id, companyId, role],
      );
      tokens[role] = await login(email);
    }
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

  async function get(
    path: string,
    role?: string,
  ): Promise<{ status: number; data: unknown; code?: string }> {
    const token = role ? tokens[role] : undefined;
    const response = await fetch(`${baseUrl}${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    const body = (await response.json()) as { data: unknown; error?: { code: string } };
    return { status: response.status, data: body.data, code: body.error?.code };
  }

  it('có quyền → cho qua và handler nhận đúng scope theo ma trận', async () => {
    assert.deepEqual(await get('/test-permission/property-delete', 'COMPANY_ADMIN'), {
      status: 200,
      data: { scope: 'COMPANY' },
      code: undefined,
    });
    assert.deepEqual((await get('/test-permission/property-delete', 'MANAGER')).data, {
      scope: 'DEPARTMENT',
    });
    assert.deepEqual((await get('/test-permission/property-edit', 'AGENT')).data, {
      scope: 'OWN',
    });
  });

  it('thiếu quyền → 403 FORBIDDEN', async () => {
    const result = await get('/test-permission/property-delete', 'AGENT');
    assert.equal(result.status, 403);
    assert.equal(result.code, 'FORBIDDEN');
  });

  it('permission không tồn tại → 403 với mọi user', async () => {
    for (const role of ['COMPANY_ADMIN', 'MANAGER', 'AGENT']) {
      assert.equal((await get('/test-permission/unknown', role)).status, 403, role);
    }
  });

  it('chưa đăng nhập → 401 trước khi kiểm quyền', async () => {
    const result = await get('/test-permission/property-delete');
    assert.equal(result.status, 401);
    assert.equal(result.code, 'UNAUTHENTICATED');
  });

  it('route không có @RequirePermission chỉ cần đăng nhập', async () => {
    assert.equal((await get('/test-permission/no-permission', 'AGENT')).status, 200);
  });

  it('@Public() kèm @RequirePermission là cấu hình sai → 401', async () => {
    assert.equal((await get('/test-permission/public-with-permission')).status, 401);
  });

  it('quyền đặt ở controller áp cho mọi route, handler ghi đè được', async () => {
    assert.deepEqual((await get('/test-permission-class', 'COMPANY_ADMIN')).data, {
      scope: 'COMPANY',
    });
    assert.equal((await get('/test-permission-class', 'MANAGER')).status, 403);
    assert.deepEqual((await get('/test-permission-class/override', 'AGENT')).data, {
      scope: 'COMPANY',
    });
  });
});
