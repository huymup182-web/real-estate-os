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

interface Team {
  id: string;
  name: string;
  department: { id: string; name: string };
  leader: { id: string; fullName: string } | null;
  memberCount: number;
  members?: { id: string; fullName: string; status: string }[];
  canManage?: boolean;
}

interface ApiError {
  error: { code: string; details?: { field?: string; message: string }[] };
}

/**
 * Công ty A: phòng Sales (manager MANAGER, leader TEAM_LEADER, agent1, agent2, quit INACTIVE, collab
 * COLLABORATOR) và phòng Marketing (agentM). admin là COMPANY_ADMIN. Công ty B: adminB.
 */
describe('/api/v1/teams', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let tenantA: string;
  const tokens: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  const departments: Record<string, string> = {};
  let salesTeam: Team;
  let marketingTeam: Team;

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
    for (const name of ['Sales', 'Marketing']) {
      departments[name] = await insertId(
        `INSERT INTO departments (tenant_id, name) VALUES ($1, $2)`,
        [tenantA, name],
      );
    }
    const roles = new Map(
      (
        (await db.query(`SELECT id, code FROM roles WHERE tenant_id = $1`, [tenantA])) as {
          id: string;
          code: string;
        }[]
      ).map((row) => [row.code, row.id]),
    );
    const hash = await hashPassword(PASSWORD);
    for (const [name, role, department, status] of [
      ['manager', 'MANAGER', 'Sales', 'ACTIVE'],
      ['leader', 'TEAM_LEADER', 'Sales', 'ACTIVE'],
      ['agent1', 'AGENT', 'Sales', 'ACTIVE'],
      ['agent2', 'AGENT', 'Sales', 'ACTIVE'],
      ['quit', 'AGENT', 'Sales', 'INACTIVE'],
      ['collab', 'COLLABORATOR', 'Sales', 'ACTIVE'],
      ['agentM', 'AGENT', 'Marketing', 'ACTIVE'],
    ] as const) {
      const id = await insertId(
        `INSERT INTO users (tenant_id, email, password_hash, full_name, status, department_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantA, `${name}@a.vn`, hash, name, status, departments[department]],
      );
      await db.query(`INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)`, [
        id,
        roles.get(role),
        tenantA,
      ]);
      userIds[name] = id;
    }
    for (const name of ['admin', 'manager', 'leader', 'agent1', 'agent2', 'collab', 'agentM']) {
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

  it('tạo team: trưởng nhóm, thành viên cùng phòng ban; ghi nhật ký', async () => {
    salesTeam = await ok<Team>(
      await as('admin', 'POST', '/teams', {
        name: ' Team Sao ',
        departmentId: departments['Sales'],
        leaderId: userIds['leader'],
        memberIds: [userIds['agent2'], userIds['agent1']],
      }),
      201,
    );
    assert.equal(salesTeam.name, 'Team Sao');
    assert.deepEqual(salesTeam.department, { id: departments['Sales'], name: 'Sales' });
    assert.deepEqual(salesTeam.leader, { id: userIds['leader'], fullName: 'leader' });
    assert.equal(salesTeam.memberCount, 2);
    assert.deepEqual(
      salesTeam.members?.map((member) => member.fullName),
      ['agent1', 'agent2'],
    );
    assert.equal(salesTeam.canManage, true);
    assert.deepEqual(await auditChanges('team.create', salesTeam.id), [
      {
        name: [null, 'Team Sao'],
        departmentId: [null, departments['Sales']],
        leaderId: [null, userIds['leader']],
        memberIds: [null, [userIds['agent1'], userIds['agent2']].sort()],
      },
    ]);

    marketingTeam = await ok<Team>(
      await as('admin', 'POST', '/teams', {
        name: 'Team Sao',
        departmentId: departments['Marketing'],
        memberIds: [userIds['agentM']],
      }),
      201,
    );
    assert.equal(marketingTeam.leader, null);
  });

  it('dữ liệu sai → 400, trùng tên trong phòng ban → 409', async () => {
    const base = { name: 'Team mới', departmentId: departments['Sales'] };
    const fieldOf = async (payload: object): Promise<string | undefined> =>
      (await errorOf(await as('admin', 'POST', '/teams', payload), 400)).details?.[0]?.field;
    assert.equal(await fieldOf({ ...base, memberIds: [userIds['agentM']] }), 'memberIds');
    assert.equal(await fieldOf({ ...base, memberIds: [userIds['quit']] }), 'memberIds');
    assert.equal(await fieldOf({ ...base, leaderId: userIds['agentM'] }), 'leaderId');
    assert.equal(
      await fieldOf({ ...base, leaderId: '00000000-0000-4000-8000-000000000000' }),
      'leaderId',
    );
    assert.equal(
      await fieldOf({ ...base, departmentId: '00000000-0000-4000-8000-000000000000' }),
      'departmentId',
    );
    for (const payload of [
      { departmentId: departments['Sales'] },
      { ...base, name: '<b>x</b>' },
      { name: 'X' },
      { ...base, leaderId: 'abc' },
      { ...base, memberIds: [userIds['agent1'], userIds['agent1']] },
      { ...base, memberIds: 'abc' },
    ]) {
      assert.equal(
        (await as('admin', 'POST', '/teams', payload)).status,
        400,
        JSON.stringify(payload),
      );
    }
    const dup = await errorOf(
      await as('admin', 'POST', '/teams', { ...base, name: 'Team Sao' }),
      409,
    );
    assert.equal(dup.details?.[0]?.field, 'name');
  });

  it('phạm vi xem: trưởng phòng thấy team phòng mình, trưởng nhóm, thành viên thấy team của mình', async () => {
    const names = async (user: string): Promise<string[]> =>
      (await ok<Team[]>(await as(user, 'GET', '/teams'))).map(
        (team) => `${team.department.name}/${team.name}`,
      );
    assert.deepEqual(await names('admin'), ['Marketing/Team Sao', 'Sales/Team Sao']);
    assert.deepEqual(await names('manager'), ['Sales/Team Sao']);
    assert.deepEqual(await names('leader'), ['Sales/Team Sao']);
    assert.deepEqual(await names('agent1'), ['Sales/Team Sao']);
    assert.deepEqual(await names('agentM'), ['Marketing/Team Sao']);
    assert.deepEqual(await names('adminB'), []);
    assert.equal((await as('collab', 'GET', '/teams')).status, 403);
    const filtered = await ok<Team[]>(
      await as('admin', 'GET', `/teams?departmentId=${departments['Marketing']}`),
    );
    assert.deepEqual(
      filtered.map((team) => team.id),
      [marketingTeam.id],
    );

    assert.equal((await as('manager', 'GET', `/teams/${marketingTeam.id}`)).status, 404);
    assert.equal((await as('adminB', 'GET', `/teams/${salesTeam.id}`)).status, 404);
    const asLeader = await ok<Team>(await as('leader', 'GET', `/teams/${salesTeam.id}`));
    assert.equal(asLeader.canManage, false);
    assert.equal(asLeader.members?.length, 2);
    const asManager = await ok<Team>(await as('manager', 'GET', `/teams/${salesTeam.id}`));
    assert.equal(asManager.canManage, true);
  });

  it('phạm vi sửa: trưởng phòng chỉ tạo, sửa team phòng mình; trưởng nhóm không sửa được', async () => {
    const options = await ok<{ departments: { id: string }[]; users: { id: string }[] }>(
      await as('manager', 'GET', '/teams/options'),
    );
    assert.deepEqual(
      options.departments.map((department) => department.id),
      [departments['Sales']],
    );
    assert.ok(!options.users.some((user) => user.id === userIds['agentM']));
    assert.ok(!options.users.some((user) => user.id === userIds['quit']));
    assert.equal((await as('leader', 'GET', '/teams/options')).status, 403);

    assert.equal(
      (
        await as('manager', 'POST', '/teams', {
          name: 'Ngoài phòng',
          departmentId: departments['Marketing'],
        })
      ).status,
      403,
    );
    const own = await ok<Team>(
      await as('manager', 'POST', '/teams', {
        name: 'Team Trăng',
        departmentId: departments['Sales'],
      }),
      201,
    );
    assert.equal(
      (await as('manager', 'PATCH', `/teams/${own.id}`, { departmentId: departments['Marketing'] }))
        .status,
      403,
    );
    assert.equal(
      (await as('manager', 'PATCH', `/teams/${marketingTeam.id}`, { name: 'X' })).status,
      404,
    );
    assert.equal(
      (await as('leader', 'PATCH', `/teams/${salesTeam.id}`, { name: 'X' })).status,
      403,
    );
    assert.equal((await as('leader', 'DELETE', `/teams/${salesTeam.id}`)).status, 403);
    assert.equal((await as('manager', 'DELETE', `/teams/${own.id}`)).status, 204);
    assert.equal((await as('manager', 'GET', `/teams/${own.id}`)).status, 404);
  });

  it('sửa team: đổi tên, trưởng nhóm, thay thành viên; giữ được thành viên đã ngừng hoạt động', async () => {
    await db.query(`INSERT INTO team_members (tenant_id, team_id, user_id) VALUES ($1, $2, $3)`, [
      tenantA,
      salesTeam.id,
      userIds['quit'],
    ]);
    const updated = await ok<Team>(
      await as('manager', 'PATCH', `/teams/${salesTeam.id}`, {
        name: 'Team Sao Sáng',
        leaderId: null,
        memberIds: [userIds['agent1'], userIds['quit'], userIds['leader']],
      }),
    );
    assert.equal(updated.name, 'Team Sao Sáng');
    assert.equal(updated.leader, null);
    assert.deepEqual(
      updated.members?.map((member) => member.fullName),
      ['agent1', 'leader', 'quit'],
    );
    assert.deepEqual(await auditChanges('team.update', salesTeam.id), [
      {
        name: ['Team Sao', 'Team Sao Sáng'],
        leaderId: [userIds['leader'], null],
        memberIds: [
          [userIds['agent1'], userIds['agent2'], userIds['quit']].sort(),
          [userIds['agent1'], userIds['leader'], userIds['quit']].sort(),
        ],
      },
    ]);
    // agent2 rời team nên không còn thấy team.
    assert.deepEqual(await ok<Team[]>(await as('agent2', 'GET', '/teams')), []);

    // Chuyển sang phòng ban khác khi thành viên vẫn ở phòng cũ → 400.
    const moved = await errorOf(
      await as('admin', 'PATCH', `/teams/${salesTeam.id}`, {
        departmentId: departments['Marketing'],
      }),
      400,
    );
    assert.equal(moved.details?.[0]?.field, 'memberIds');
    // Thêm lại người đã ngừng hoạt động như thành viên mới → 400.
    await ok<Team>(
      await as('manager', 'PATCH', `/teams/${salesTeam.id}`, { memberIds: [userIds['agent1']] }),
    );
    const readd = await errorOf(
      await as('manager', 'PATCH', `/teams/${salesTeam.id}`, {
        memberIds: [userIds['agent1'], userIds['quit']],
      }),
      400,
    );
    assert.equal(readd.details?.[0]?.field, 'memberIds');
  });

  it('xoá team: xoá mềm, ghi nhật ký, phòng ban xoá được khi hết team', async () => {
    assert.equal((await as('admin', 'DELETE', `/teams/${marketingTeam.id}`)).status, 204);
    assert.equal((await as('admin', 'GET', `/teams/${marketingTeam.id}`)).status, 404);
    assert.deepEqual(await auditChanges('team.delete', marketingTeam.id), [
      { name: ['Team Sao', null], memberIds: [[userIds['agentM']], null] },
    ]);
    const [members] = (await db.query(
      `SELECT count(*)::int AS count FROM team_members WHERE team_id = $1`,
      [marketingTeam.id],
    )) as { count: number }[];
    assert.equal(members?.count, 1);
    assert.deepEqual(await ok<Team[]>(await as('agentM', 'GET', '/teams')), []);
    // Tên team đã xoá dùng lại được.
    await ok<Team>(
      await as('admin', 'POST', '/teams', {
        name: 'Team Sao',
        departmentId: departments['Marketing'],
      }),
      201,
    );
  });
});
