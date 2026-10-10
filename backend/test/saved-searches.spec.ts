import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { hashPassword } from '../src/auth/password.js';
import { PermissionService } from '../src/auth/permission.service.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

interface Detail {
  id: string;
  updatedAt: string;
  updatedBy: string | null;
  isFavorite: boolean;
  ownerContactVisible: boolean;
  [key: string]: unknown;
}

/**
 * Công ty A: admin; phòng D1 có `manager` (MANAGER), team T1 (trưởng nhóm `leader`) gồm agent1, agent2;
 * phòng D2 có agent4. Công ty B: adminB. Mỗi test dùng tên/từ khoá riêng nên không phụ thuộc nhau.
 */
describe('Tìm kiếm đã lưu /api/v1/saved-searches (TASK-075)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let tenantA: string;
  let khanhHoa: string;
  let nhaTrang: string;
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
    nhaTrang = await insertId(
      `INSERT INTO districts (province_id, code, name) VALUES ($1, '568', 'Nha Trang')`,
      [khanhHoa],
    );
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
    const hash = await hashPassword(PASSWORD);
    for (const [name, role, department] of [
      ['manager', 'MANAGER', d1],
      ['leader', 'TEAM_LEADER', d1],
      ['agent1', 'AGENT', d1],
      ['agent2', 'AGENT', d1],
      ['agent4', 'AGENT', d2],
    ] as const) {
      userIds[name] = await insertUser(name, hash, department, role);
    }
    const team = await insertId(
      `INSERT INTO teams (tenant_id, department_id, name, leader_id) VALUES ($1, $2, 'T1', $3)`,
      [tenantA, d1, userIds['leader']],
    );
    for (const name of ['agent1', 'agent2']) {
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

  let tagSeq = 0;
  function tag(): string {
    tagSeq += 1;
    return `zs${'abcdefghij'[tagSeq % 10]}${'klmnopqrst'[Math.floor(tagSeq / 10) % 10]}y`;
  }

  async function createProperty(values: Record<string, unknown>, user = 'agent1'): Promise<Detail> {
    const response = await request(
      'POST',
      '/properties',
      {
        title: 'Nhà phố',
        propertyType: 'HOUSE',
        price: 3_500_000_000,
        area: 70,
        provinceId: khanhHoa,
        districtId: nhaTrang,
        wardId: vinhHai,
        ...values,
      },
      tokens[user],
    );
    assert.equal(response.status, 201, await response.clone().text());
    return ((await response.json()) as { data: Detail }).data;
  }

  interface Saved {
    id: string;
    name: string;
    filters: Record<string, unknown>;
    notify: boolean;
    lastNotifiedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }

  async function save(payload: Record<string, unknown>, user = 'agent1'): Promise<Saved> {
    const response = await request('POST', '/saved-searches', payload, tokens[user]);
    assert.equal(response.status, 201, await response.clone().text());
    return ((await response.json()) as { data: Saved }).data;
  }

  async function errorFields(response: Response): Promise<string[]> {
    const body = (await response.json()) as { error: { details?: { field: string }[] } };
    return (body.error.details ?? []).map((detail) => detail.field);
  }

  it('lưu tìm kiếm: bộ lọc được chuẩn hoá theo schema của GET /properties, notify mặc định bật', async () => {
    const saved = await save({
      name: '  Nhà phố Vĩnh Hải  ',
      filters: {
        q: '  nha pho  ',
        priceMin: '1000000000',
        priceMax: 5_000_000_000,
        propertyType: 'HOUSE, LAND',
        legalStatus: ['PRIVATE_BOOK'],
        wardId: vinhHai,
        sort: 'price_asc',
      },
    });
    assert.equal(saved.name, 'Nhà phố Vĩnh Hải');
    assert.equal(saved.notify, true);
    assert.equal(saved.lastNotifiedAt, null);
    assert.deepEqual(saved.filters, {
      q: 'nha pho',
      priceMin: 1_000_000_000,
      priceMax: 5_000_000_000,
      wardId: vinhHai,
      propertyType: ['HOUSE', 'LAND'],
      legalStatus: ['PRIVATE_BOOK'],
      sort: 'price_asc',
    });

    const one = await request('GET', `/saved-searches/${saved.id}`, undefined, tokens['agent1']);
    assert.equal(one.status, 200);
    assert.deepEqual(((await one.json()) as { data: Saved }).data, saved);

    const quiet = await save({ name: 'Không báo', filters: {}, notify: false });
    assert.equal(quiet.notify, false);
    assert.deepEqual(quiet.filters, {});
  });

  it('chạy lại tìm kiếm đã lưu: kết quả như GET /properties với bộ lọc đã lưu, có phân trang', async () => {
    const word = tag();
    const cheap = await createProperty({
      title: `Căn hộ ${word}`,
      propertyType: 'APARTMENT',
      price: 1_000_000_000,
    });
    const mid = await createProperty({
      title: `Căn hộ ${word}`,
      propertyType: 'APARTMENT',
      price: 2_000_000_000,
    });
    await createProperty({ title: `Nhà ${word}`, propertyType: 'HOUSE', price: 1_500_000_000 });
    await createProperty({
      title: `Căn hộ ${word}`,
      propertyType: 'APARTMENT',
      price: 9_000_000_000,
    });
    const saved = await save({
      name: 'Căn hộ dưới 3 tỷ',
      filters: { q: word, propertyType: 'APARTMENT', priceMax: 3_000_000_000, sort: 'price_desc' },
    });

    const run = async (extra = '') => {
      const response = await request(
        'GET',
        `/saved-searches/${saved.id}/properties${extra}`,
        undefined,
        tokens['agent1'],
      );
      assert.equal(response.status, 200, await response.clone().text());
      return (await response.json()) as {
        data: { id: string }[];
        meta: { page: number; pageSize: number; total: number; totalPages: number };
      };
    };
    const all = await run();
    assert.deepEqual(
      all.data.map((item) => item.id),
      [mid.id, cheap.id],
    );
    assert.deepEqual(all.meta, { page: 1, pageSize: 20, total: 2, totalPages: 1 });
    const second = await run('?page=2&pageSize=1');
    assert.deepEqual(
      second.data.map((item) => item.id),
      [cheap.id],
    );
    const bad = await request(
      'GET',
      `/saved-searches/${saved.id}/properties?page=0`,
      undefined,
      tokens['agent1'],
    );
    assert.equal(bad.status, 400);
  });

  it('bộ lọc sai → 400 theo từng trường filters.*', async () => {
    const cases: [unknown, string][] = [
      [{ propertyType: 'CASTLE' }, 'filters.propertyType'],
      [{ priceMin: 5, priceMax: 1 }, 'filters.priceMax'],
      [{ areaMin: -1 }, 'filters.areaMin'],
      [{ sort: 'p.price' }, 'filters.sort'],
      [{ wardId: 'abc' }, 'filters.wardId'],
      [{ foo: 'bar' }, 'filters.foo'],
      [{ page: 2 }, 'filters.page'],
      [{ pageSize: 50 }, 'filters.pageSize'],
      [[], 'filters'],
      ['q=nha', 'filters'],
      [null, 'filters'],
    ];
    for (const [filters, field] of cases) {
      const response = await request(
        'POST',
        '/saved-searches',
        { name: 'Sai', filters },
        tokens['agent1'],
      );
      assert.equal(response.status, 400, JSON.stringify(filters));
      assert.ok((await errorFields(response)).includes(field), JSON.stringify(filters));
    }
    for (const payload of [
      { name: '   ', filters: {} },
      { name: 'x'.repeat(101), filters: {} },
      { name: '<b>Nhà</b>', filters: {} },
      { filters: {} },
      { name: 'Thiếu bộ lọc' },
      { name: 'Notify sai', filters: {}, notify: 'yes' },
      { name: 'Trường lạ', filters: {}, userId: userIds['agent2'] },
    ]) {
      const response = await request('POST', '/saved-searches', payload, tokens['agent1']);
      assert.equal(response.status, 400, JSON.stringify(payload));
    }
  });

  it('sửa tên, bật tắt thông báo, thay bộ lọc; body rỗng hoặc bộ lọc sai → 400', async () => {
    const saved = await save({ name: 'Cũ', filters: { q: 'nha', priceMax: 3_000_000_000 } });
    const patch = async (payload: unknown) =>
      request('PATCH', `/saved-searches/${saved.id}`, payload, tokens['agent1']);

    let response = await patch({ name: ' Mới ', notify: false });
    assert.equal(response.status, 200);
    let data = ((await response.json()) as { data: Saved }).data;
    assert.equal(data.name, 'Mới');
    assert.equal(data.notify, false);
    assert.deepEqual(data.filters, { q: 'nha', priceMax: 3_000_000_000 });

    response = await patch({ filters: { direction: 'E,SE' } });
    assert.equal(response.status, 200);
    data = ((await response.json()) as { data: Saved }).data;
    assert.deepEqual(data.filters, { direction: ['E', 'SE'] });
    assert.equal(data.name, 'Mới');
    assert.equal(data.notify, false);

    assert.equal((await patch({})).status, 400);
    response = await patch({ filters: { bedroomsMin: 3, bedroomsMax: 2 } });
    assert.equal(response.status, 400);
    assert.deepEqual(await errorFields(response), ['filters.bedroomsMax']);
    assert.equal((await patch({ name: '' })).status, 400);
  });

  it('xoá → 204; sau đó không xem, sửa, chạy, xoá lại được và không còn trong danh sách', async () => {
    const saved = await save({ name: 'Sẽ xoá', filters: {} });
    const path = `/saved-searches/${saved.id}`;
    assert.equal((await request('DELETE', path, undefined, tokens['agent1'])).status, 204);
    assert.equal((await request('GET', path, undefined, tokens['agent1'])).status, 404);
    assert.equal(
      (await request('GET', `${path}/properties`, undefined, tokens['agent1'])).status,
      404,
    );
    assert.equal((await request('PATCH', path, { notify: false }, tokens['agent1'])).status, 404);
    assert.equal((await request('DELETE', path, undefined, tokens['agent1'])).status, 404);
    const list = await request('GET', '/saved-searches?pageSize=100', undefined, tokens['agent1']);
    const ids = ((await list.json()) as { data: Saved[] }).data.map((item) => item.id);
    assert.ok(!ids.includes(saved.id));
  });

  it('chỉ thấy tìm kiếm của mình: người khác, cấp trên, công ty khác → 404', async () => {
    const mine = await save({ name: `Của agent1 ${tag()}`, filters: {} });
    const other = await save({ name: `Của agent2 ${tag()}`, filters: {} }, 'agent2');
    const list = await request('GET', '/saved-searches?pageSize=100', undefined, tokens['agent1']);
    assert.equal(list.status, 200);
    const ids = ((await list.json()) as { data: Saved[] }).data.map((item) => item.id);
    assert.ok(ids.includes(mine.id));
    assert.ok(!ids.includes(other.id));
    for (const user of ['agent2', 'leader', 'manager', 'admin', 'adminB']) {
      const path = `/saved-searches/${mine.id}`;
      assert.equal((await request('GET', path, undefined, tokens[user])).status, 404, user);
      assert.equal(
        (await request('GET', `${path}/properties`, undefined, tokens[user])).status,
        404,
        user,
      );
      assert.equal((await request('PATCH', path, { name: 'x' }, tokens[user])).status, 404, user);
      assert.equal((await request('DELETE', path, undefined, tokens[user])).status, 404, user);
    }
    const still = await request('GET', `/saved-searches/${mine.id}`, undefined, tokens['agent1']);
    assert.equal(((await still.json()) as { data: Saved }).data.name, mine.name);
  });

  it('mỗi người tối đa 50 tìm kiếm đã lưu → 422; xoá bớt thì lưu tiếp được', async () => {
    await db.query(`UPDATE saved_searches SET deleted_at = now() WHERE user_id = $1`, [
      userIds['agent4'],
    ]);
    for (let index = 0; index < 50; index += 1) {
      await db.query(
        `INSERT INTO saved_searches (tenant_id, user_id, name, filters) VALUES ($1, $2, $3, '{}')`,
        [tenantA, userIds['agent4'], `S${index}`],
      );
    }
    const response = await request(
      'POST',
      '/saved-searches',
      { name: 'Thứ 51', filters: {} },
      tokens['agent4'],
    );
    assert.equal(response.status, 422);
    const [first] = (await db.query(
      `SELECT id FROM saved_searches WHERE user_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userIds['agent4']],
    )) as { id: string }[];
    assert.ok(first);
    assert.equal(
      (await request('DELETE', `/saved-searches/${first.id}`, undefined, tokens['agent4'])).status,
      204,
    );
    await save({ name: 'Thứ 50 sau khi xoá', filters: {} }, 'agent4');
  });

  it('id sai dạng → 400; chưa đăng nhập → 401; không có property.view → 403', async () => {
    assert.equal(
      (await request('GET', '/saved-searches/abc', undefined, tokens['agent1'])).status,
      400,
    );
    assert.equal((await request('GET', '/saved-searches')).status, 401);
    assert.equal(
      (await request('POST', '/saved-searches', { name: 'x', filters: {} })).status,
      401,
    );
    const removed = (await db.query(
      `DELETE FROM role_permissions rp USING roles r, permissions p
        WHERE rp.role_id = r.id AND rp.permission_id = p.id
          AND r.tenant_id = $1 AND r.code = 'AGENT' AND p.code = 'property.view'
        RETURNING rp.role_id, rp.permission_id, rp.scope`,
      [tenantA],
    )) as [{ role_id: string; permission_id: string; scope: string }[], number];
    app.get(PermissionService).invalidate();
    try {
      assert.equal(
        (await request('GET', '/saved-searches', undefined, tokens['agent1'])).status,
        403,
      );
      assert.equal(
        (await request('POST', '/saved-searches', { name: 'x', filters: {} }, tokens['agent1']))
          .status,
        403,
      );
    } finally {
      for (const row of removed[0]) {
        await db.query(
          `INSERT INTO role_permissions (role_id, permission_id, scope) VALUES ($1, $2, $3)`,
          [row.role_id, row.permission_id, row.scope],
        );
      }
      app.get(PermissionService).invalidate();
    }
  });
});
