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

interface User {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: string;
  department: { id: string; name: string } | null;
  roles: { id: string; code: string; name: string }[];
  [key: string]: unknown;
}

interface ApiError {
  error: { code: string; details?: { field?: string }[] };
}

/**
 * Công ty A: admin, admin2 (cùng COMPANY_ADMIN); hr (role tuỳ chỉnh: user.view + user.manage COMPANY);
 * phòng D1 có manager (MANAGER, user.view DEPARTMENT), leader (TEAM_LEADER, team T1 gồm agent1), agent1,
 * agent3; phòng D2 có agent4. Công ty B có adminB.
 */
describe('/api/v1/users', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let tenantA: string;
  const tokens: Record<string, string> = {};
  const refreshTokens: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  const roleIds: Record<string, string> = {};
  const departments: Record<string, string> = {};

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
    departments['D1'] = await insertId(
      `INSERT INTO departments (tenant_id, name) VALUES ($1, 'Phòng 1')`,
      [tenantA],
    );
    departments['D2'] = await insertId(
      `INSERT INTO departments (tenant_id, name) VALUES ($1, 'Phòng 2')`,
      [tenantA],
    );
    const hrRole = await insertId(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'HR', 'Nhân sự')`,
      [tenantA],
    );
    await db.query(
      `INSERT INTO role_permissions (role_id, permission_id, scope)
       SELECT $1, id, 'COMPANY' FROM permissions WHERE code IN ('user.view', 'user.manage')`,
      [hrRole],
    );
    for (const row of (await db.query(`SELECT id, code FROM roles WHERE tenant_id = $1`, [
      tenantA,
    ])) as { id: string; code: string }[]) {
      roleIds[row.code] = row.id;
    }
    const hash = await hashPassword(PASSWORD);
    for (const [name, role, department] of [
      ['admin2', 'COMPANY_ADMIN', null],
      ['hr', 'HR', null],
      ['manager', 'MANAGER', departments['D1']],
      ['leader', 'TEAM_LEADER', departments['D1']],
      ['agent1', 'AGENT', departments['D1']],
      ['agent3', 'AGENT', departments['D1']],
      ['agent4', 'AGENT', departments['D2']],
    ] as const) {
      userIds[name] = await insertUser(name, hash, department ?? null, role);
    }
    const team = await insertId(
      `INSERT INTO teams (tenant_id, department_id, name, leader_id) VALUES ($1, $2, 'T1', $3)`,
      [tenantA, departments['D1'], userIds['leader']],
    );
    await db.query(`INSERT INTO team_members (tenant_id, team_id, user_id) VALUES ($1, $2, $3)`, [
      tenantA,
      team,
      userIds['agent1'],
    ]);
    for (const name of Object.keys(userIds)) {
      await login(name, `${name}@a.vn`);
    }
    const companyB = await register('admin@b.vn');
    userIds['adminB'] = companyB.userId;
    await login('adminB', 'admin@b.vn');
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
    department: string | null,
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

  async function login(name: string, identifier: string, password = PASSWORD): Promise<Response> {
    const response = await request('POST', '/auth/login', { identifier, password });
    if (response.status === 200) {
      const data = (
        (await response.clone().json()) as {
          data: { accessToken: string; refreshToken: string };
        }
      ).data;
      tokens[name] = data.accessToken;
      refreshTokens[name] = data.refreshToken;
    }
    return response;
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

  const names = (users: User[]): string[] => users.map((user) => user.fullName).sort();

  describe('xem', () => {
    it('COMPANY thấy mọi người trong công ty, mới tạo trước, kèm phòng ban và vai trò', async () => {
      const response = await as('admin', 'GET', '/users?pageSize=100');
      const body = (await response.json()) as { data: User[]; meta: { total: number } };
      assert.equal(response.status, 200);
      assert.equal(body.meta.total, 8);
      assert.deepEqual(names(body.data), [
        'Quản trị',
        'admin2',
        'agent1',
        'agent3',
        'agent4',
        'hr',
        'leader',
        'manager',
      ]);
      const agent1 = body.data.find((user) => user.id === userIds['agent1']);
      assert.deepEqual(agent1?.department, { id: departments['D1'], name: 'Phòng 1' });
      assert.deepEqual(agent1?.roles, [{ id: roleIds['AGENT'], code: 'AGENT', name: 'Môi giới' }]);
      assert.equal('passwordHash' in (agent1 ?? {}), false);
    });

    it('lọc theo từ khoá, trạng thái, vai trò, phòng ban và phân trang', async () => {
      const byName = await ok<User[]>(await as('admin', 'GET', '/users?q=AGENT'));
      assert.deepEqual(names(byName), ['agent1', 'agent3', 'agent4']);
      const literal = await ok<User[]>(await as('admin', 'GET', '/users?q=%25'));
      assert.deepEqual(literal, []);
      const byRole = await ok<User[]>(
        await as('admin', 'GET', `/users?roleId=${roleIds['AGENT']}`),
      );
      assert.deepEqual(names(byRole), ['agent1', 'agent3', 'agent4']);
      const byDepartment = await ok<User[]>(
        await as('admin', 'GET', `/users?departmentId=${departments['D2']}`),
      );
      assert.deepEqual(names(byDepartment), ['agent4']);
      const locked = await ok<User[]>(await as('admin', 'GET', '/users?status=LOCKED'));
      assert.deepEqual(locked, []);
      const response = await as('admin', 'GET', '/users?pageSize=3&page=2');
      const body = (await response.json()) as { data: User[]; meta: { totalPages: number } };
      assert.equal(body.data.length, 3);
      assert.equal(body.meta.totalPages, 3);
      await errorOf(await as('admin', 'GET', '/users?status=GONE'), 400);
    });

    it('DEPARTMENT chỉ thấy phòng mình, TEAM chỉ thấy team mình, AGENT không có quyền', async () => {
      const manager = await ok<User[]>(await as('manager', 'GET', '/users'));
      assert.deepEqual(names(manager), ['agent1', 'agent3', 'leader', 'manager']);
      const leader = await ok<User[]>(await as('leader', 'GET', '/users'));
      assert.deepEqual(names(leader), ['agent1', 'leader']);
      await errorOf(await as('agent1', 'GET', '/users'), 403);
    });

    it('chi tiết: ngoài phạm vi hoặc công ty khác → 404', async () => {
      const user = await ok<User>(await as('manager', 'GET', `/users/${userIds['agent3']}`));
      assert.equal(user.email, 'agent3@a.vn');
      await errorOf(await as('manager', 'GET', `/users/${userIds['agent4']}`), 404);
      await errorOf(await as('admin', 'GET', `/users/${userIds['adminB']}`), 404);
    });

    it('options trả vai trò và phòng ban của công ty, cần user.manage', async () => {
      const options = await ok<{ roles: { code: string }[]; departments: { name: string }[] }>(
        await as('admin', 'GET', '/users/options'),
      );
      assert.equal(options.roles.length, 7);
      assert.deepEqual(
        options.departments.map((department) => department.name),
        ['Phòng 1', 'Phòng 2'],
      );
      await errorOf(await as('manager', 'GET', '/users/options'), 403);
    });
  });

  describe('tạo', () => {
    it('admin tạo user có vai trò và phòng ban; user đăng nhập được bằng mật khẩu ban đầu', async () => {
      const created = await ok<User>(
        await as('admin', 'POST', '/users', {
          fullName: '  Nhân viên Mới ',
          email: 'moi@a.vn',
          phone: '+84900000001',
          password: 'mat-khau-ban-dau',
          departmentId: departments['D2'],
          roleIds: [roleIds['AGENT'], roleIds['TEAM_LEADER']],
        }),
        201,
      );
      assert.equal(created.fullName, 'Nhân viên Mới');
      assert.equal(created.status, 'ACTIVE');
      assert.equal(created.department?.id, departments['D2']);
      assert.deepEqual(
        created.roles.map((role) => role.code),
        ['AGENT', 'TEAM_LEADER'],
      );
      assert.equal((await login('moi', '+84900000001', 'mat-khau-ban-dau')).status, 200);

      const [audit] = (await db.query(
        `SELECT user_id, changes FROM audit_logs WHERE action = 'user.create' AND entity_id = $1`,
        [created.id],
      )) as { user_id: string; changes: Record<string, unknown> }[];
      assert.equal(audit?.user_id, userIds['admin']);
      assert.deepEqual(audit?.changes['roles'], [null, ['AGENT', 'TEAM_LEADER']]);
      assert.equal(JSON.stringify(audit?.changes).includes('mat-khau'), false);
    });

    it('dữ liệu sai → 400; email/SĐT đã dùng (kể cả công ty khác) → 409', async () => {
      const base = { fullName: 'A', password: PASSWORD, roleIds: [roleIds['AGENT']] };
      for (const [payload, field] of [
        [{ ...base }, 'email'],
        [{ ...base, email: 'x@a.vn', roleIds: [] }, 'roleIds'],
        [{ ...base, email: 'x@a.vn', password: 'ngan' }, 'password'],
        [{ ...base, email: 'x@a.vn', phone: '0901' }, 'phone'],
        [{ ...base, email: 'x@a.vn', departmentId: 'abc' }, 'departmentId'],
      ] as const) {
        const error = await errorOf(await as('admin', 'POST', '/users', payload), 400);
        assert.equal(error.details?.[0]?.field, field, JSON.stringify(payload));
      }
      const [roleB] = (await db.query(
        `SELECT r.id FROM roles r JOIN users u ON u.tenant_id = r.tenant_id
          WHERE u.id = $1 AND r.code = 'AGENT'`,
        [userIds['adminB']],
      )) as { id: string }[];
      const foreignRole = await errorOf(
        await as('admin', 'POST', '/users', { ...base, email: 'x@a.vn', roleIds: [roleB?.id] }),
        400,
      );
      assert.equal(foreignRole.details?.[0]?.field, 'roleIds');
      const duplicate = await errorOf(
        await as('admin', 'POST', '/users', { ...base, email: 'ADMIN@B.VN' }),
        409,
      );
      assert.equal(duplicate.details?.[0]?.field, 'email');
    });

    it('không có user.manage COMPANY → 403; gán vai trò quyền cao hơn mình → 403', async () => {
      const payload = {
        fullName: 'B',
        email: 'b@a.vn',
        password: PASSWORD,
        roleIds: [roleIds['AGENT']],
      };
      await errorOf(await as('manager', 'POST', '/users', payload), 403);
      // hr chỉ có user.view/user.manage nên không gán được AGENT (có property.*, customer.*…).
      const escalation = await errorOf(await as('hr', 'POST', '/users', payload), 403);
      assert.equal(escalation.code, 'FORBIDDEN');
      const created = await ok<User>(
        await as('hr', 'POST', '/users', { ...payload, roleIds: [roleIds['HR']] }),
        201,
      );
      assert.deepEqual(
        created.roles.map((role) => role.code),
        ['HR'],
      );
    });
  });

  describe('sửa', () => {
    it('sửa thông tin, phòng ban và vai trò; quyền mới có hiệu lực ngay', async () => {
      await errorOf(await as('agent3', 'GET', '/users'), 403);
      const updated = await ok<User>(
        await as('admin', 'PATCH', `/users/${userIds['agent3']}`, {
          fullName: 'Agent Ba',
          phone: '+84900000003',
          departmentId: null,
          roleIds: [roleIds['MANAGER']],
        }),
      );
      assert.equal(updated.fullName, 'Agent Ba');
      assert.equal(updated.phone, '+84900000003');
      assert.equal(updated.department, null);
      assert.deepEqual(
        updated.roles.map((role) => role.code),
        ['MANAGER'],
      );
      assert.equal((await as('agent3', 'GET', '/users')).status, 200);

      const [audit] = (await db.query(
        `SELECT changes FROM audit_logs WHERE action = 'user.update' AND entity_id = $1`,
        [userIds['agent3']],
      )) as { changes: Record<string, unknown> }[];
      assert.deepEqual(audit?.changes['roles'], [['AGENT'], ['MANAGER']]);
      assert.deepEqual(audit?.changes['fullName'], ['agent3', 'Agent Ba']);
    });

    it('bỏ cả email lẫn SĐT → 400; trùng → 409; công ty khác → 404', async () => {
      const both = await errorOf(
        await as('admin', 'PATCH', `/users/${userIds['agent4']}`, { email: null }),
        400,
      );
      assert.equal(both.details?.[0]?.field, 'email');
      await errorOf(
        await as('admin', 'PATCH', `/users/${userIds['agent4']}`, { email: 'agent1@a.vn' }),
        409,
      );
      await errorOf(
        await as('admin', 'PATCH', `/users/${userIds['adminB']}`, { fullName: 'X' }),
        404,
      );
    });

    it('không tự đổi vai trò của mình → 422', async () => {
      const error = await errorOf(
        await as('admin', 'PATCH', `/users/${userIds['admin']}`, { roleIds: [roleIds['AGENT']] }),
        422,
      );
      assert.equal(error.code, 'BUSINESS_RULE_VIOLATION');
      // Sửa tên của chính mình vẫn được.
      await ok<User>(
        await as('admin', 'PATCH', `/users/${userIds['admin']}`, { fullName: 'Quản trị' }),
      );
    });
  });

  describe('trạng thái', () => {
    it('khoá tài khoản: chặn ngay token đang dùng, thu hồi refresh token, không đăng nhập được', async () => {
      const locked = await ok<User>(
        await as('admin', 'POST', `/users/${userIds['agent4']}/status`, { status: 'LOCKED' }),
      );
      assert.equal(locked.status, 'LOCKED');
      await errorOf(await request('GET', '/auth/me', undefined, tokens['agent4']), 403);
      const refresh = await request('POST', '/auth/refresh', {
        refreshToken: refreshTokens['agent4'],
      });
      assert.notEqual(refresh.status, 200);
      assert.equal((await login('agent4', 'agent4@a.vn')).status, 403);

      await ok<User>(
        await as('admin', 'POST', `/users/${userIds['agent4']}/status`, { status: 'ACTIVE' }),
      );
      assert.equal((await login('agent4', 'agent4@a.vn')).status, 200);
      const [audit] = (await db.query(
        `SELECT changes FROM audit_logs WHERE action = 'user.status' AND entity_id = $1
          ORDER BY created_at LIMIT 1`,
        [userIds['agent4']],
      )) as { changes: Record<string, unknown> }[];
      assert.deepEqual(audit?.changes['status'], ['ACTIVE', 'LOCKED']);
    });

    it('không tự đổi trạng thái; ngoài phạm vi quản lý → 403; giá trị sai → 400', async () => {
      await errorOf(
        await as('admin', 'POST', `/users/${userIds['admin']}/status`, { status: 'INACTIVE' }),
        422,
      );
      await errorOf(
        await as('manager', 'POST', `/users/${userIds['agent1']}/status`, { status: 'LOCKED' }),
        403,
      );
      await errorOf(
        await as('admin', 'POST', `/users/${userIds['agent1']}/status`, { status: 'GONE' }),
        400,
      );
    });

    it('luôn còn ít nhất một quản trị công ty đang hoạt động', async () => {
      await ok<User>(
        await as('admin', 'POST', `/users/${userIds['admin2']}/status`, { status: 'INACTIVE' }),
      );
      const lock = await errorOf(
        await as('hr', 'POST', `/users/${userIds['admin']}/status`, { status: 'LOCKED' }),
        422,
      );
      assert.equal(lock.code, 'BUSINESS_RULE_VIOLATION');
      await errorOf(await as('admin2', 'GET', '/users'), 403);
      // admin2 đang ngừng hoạt động: gỡ COMPANY_ADMIN của admin cũng bị chặn. hr không gán được
      // COMPANY_ADMIN cho người khác (vượt quyền), nên dùng admin để kích hoạt lại admin2.
      await ok<User>(
        await as('admin', 'POST', `/users/${userIds['admin2']}/status`, { status: 'ACTIVE' }),
      );
      await ok<User>(
        await as('admin', 'PATCH', `/users/${userIds['admin2']}`, { roleIds: [roleIds['AGENT']] }),
      );
      const demote = await errorOf(
        await as('hr', 'PATCH', `/users/${userIds['admin']}`, { roleIds: [roleIds['HR']] }),
        422,
      );
      assert.equal(demote.code, 'BUSINESS_RULE_VIOLATION');
    });
  });

  it('chưa đăng nhập → 401', async () => {
    await errorOf(await request('GET', '/users'), 401);
  });
});
