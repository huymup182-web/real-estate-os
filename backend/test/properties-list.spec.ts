import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { hashPassword } from '../src/auth/password.js';
import { PermissionService } from '../src/auth/permission.service.js';
import { StorageService } from '../src/storage/storage.service.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

interface Item {
  id: string;
  code: string;
  agentId: string;
  streetAddress: string | null;
  latitude: number | null;
  ownerId: string | null;
  ownerContactVisible: boolean;
  [key: string]: unknown;
}

interface ListBody {
  success: boolean;
  data: Item[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

/**
 * Công ty A: admin; team T1 (trưởng nhóm `leader`) gồm agent1, agent2; `loner` (AGENT, không team);
 * `ownOnly` (role tuỳ chỉnh: property.view + create phạm vi OWN).
 * BĐS: agent1 ×2, agent2 ×1, loner ×1, ownOnly ×1 (tạo theo thứ tự này), thêm 1 BĐS đã xoá mềm.
 * Công ty B có 1 BĐS.
 */
describe('GET /api/v1/properties', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let tenantA: string;
  let province: string;
  let ward: string;
  const tokens: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  const created: { id: string; by: string }[] = [];
  let deletedId: string;
  let otherCompanyId: string;

  before(async () => {
    await useTestDatabase();
    app = await createApp();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    db = app.get(DataSource);
    app.get(StorageService).readUrl = (key: string) => Promise.resolve(`https://cdn.test/${key}`);

    province = await insertId(`INSERT INTO provinces (code, name) VALUES ('56', 'Khánh Hòa')`);
    ward = await insertId(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, '22330', 'Vĩnh Hải')`,
      [province],
    );

    const admin = await register('admin@a.vn');
    tenantA = admin.tenantId;
    userIds['admin'] = admin.userId;
    const department = await insertId(
      `INSERT INTO departments (tenant_id, name) VALUES ($1, 'D1')`,
      [tenantA],
    );
    const hash = await hashPassword(PASSWORD);
    for (const [name, role] of [
      ['leader', 'TEAM_LEADER'],
      ['agent1', 'AGENT'],
      ['agent2', 'AGENT'],
      ['loner', 'AGENT'],
    ] as const) {
      userIds[name] = await insertUser(name, hash, department, role);
    }
    const team = await insertId(
      `INSERT INTO teams (tenant_id, department_id, name, leader_id) VALUES ($1, $2, 'T1', $3)`,
      [tenantA, department, userIds['leader']],
    );
    for (const name of ['agent1', 'agent2']) {
      await db.query(`INSERT INTO team_members (tenant_id, team_id, user_id) VALUES ($1, $2, $3)`, [
        tenantA,
        team,
        userIds[name],
      ]);
    }
    const ownRole = await insertId(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'OWN_VIEWER', 'Chỉ xem BĐS của mình')`,
      [tenantA],
    );
    await db.query(
      `INSERT INTO role_permissions (role_id, permission_id, scope)
       SELECT $1, id, 'OWN' FROM permissions WHERE code IN ('property.view', 'property.create')`,
      [ownRole],
    );
    userIds['ownOnly'] = await insertUser('ownOnly', hash, null, 'OWN_VIEWER');

    for (const name of Object.keys(userIds)) {
      tokens[name] = await login(`${name}@a.vn`);
    }

    for (const by of ['agent1', 'agent1', 'agent2', 'loner', 'ownOnly']) {
      created.push({ id: await createProperty(tokens[by]), by });
    }
    deletedId = await createProperty(tokens['agent1']);
    await db.query('UPDATE properties SET deleted_at = now() WHERE id = $1', [deletedId]);

    await register('admin@b.vn');
    otherCompanyId = await createProperty(await login('admin@b.vn'));
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

  async function createProperty(token: string | undefined): Promise<string> {
    const response = await request(
      'POST',
      '/properties',
      {
        title: 'Nhà phố Vĩnh Hải',
        propertyType: 'HOUSE',
        price: 3_500_000_000,
        area: 70,
        provinceId: province,
        wardId: ward,
        streetAddress: '12 Đường 2/4',
        latitude: 12.276543,
        longitude: 109.198765,
      },
      token,
    );
    assert.equal(response.status, 201);
    return ((await response.json()) as { data: { id: string } }).data.id;
  }

  async function list(user: string, query = ''): Promise<ListBody> {
    const response = await request('GET', `/properties${query}`, undefined, tokens[user]);
    assert.equal(response.status, 200, user);
    return (await response.json()) as ListBody;
  }

  /** id các BĐS công ty A còn sống, mới tạo trước. */
  function newestFirst(filter: (entry: { by: string }) => boolean = () => true): string[] {
    return created
      .filter(filter)
      .map((entry) => entry.id)
      .reverse();
  }

  it('phạm vi COMPANY: mọi BĐS của công ty, mới tạo trước; không có BĐS đã xoá hay của công ty khác', async () => {
    const body = await list('admin');
    assert.equal(body.success, true);
    assert.deepEqual(
      body.data.map((item) => item.id),
      newestFirst(),
    );
    assert.deepEqual(body.meta, { page: 1, pageSize: 20, total: 5, totalPages: 1 });
    const ids = body.data.map((item) => item.id);
    assert.equal(ids.includes(deletedId), false);
    assert.equal(ids.includes(otherCompanyId), false);
    assert.equal('tenantId' in (body.data[0] ?? {}), false);
  });

  it('mỗi dòng có tên tỉnh, phường/xã và ảnh bìa (null khi chưa có ảnh)', async () => {
    const [first] = created;
    assert.ok(first);
    await db.query(
      `INSERT INTO property_images (tenant_id, property_id, storage_key, thumbnail_key, mime_type, size_bytes, sort_order, is_cover)
       VALUES ($1, $2, $3 || 'cover.jpg', $3 || 'cover_thumb.webp', 'image/jpeg', 1000, 0, true),
              ($1, $2, $3 || 'other.jpg', NULL, 'image/jpeg', 1000, 1, false)`,
      [tenantA, first.id, `${tenantA}/properties/${first.id}/`],
    );
    const prefix = `https://cdn.test/${tenantA}/properties/${first.id}/`;
    const body = await list('admin');
    const withCover = body.data.find((item) => item.id === first.id);
    assert.equal(withCover?.provinceName, 'Khánh Hòa');
    assert.equal(withCover?.wardName, 'Vĩnh Hải');
    assert.deepEqual(withCover?.coverImage, {
      url: `${prefix}cover.jpg`,
      thumbnailUrl: `${prefix}cover_thumb.webp`,
    });
    assert.ok(
      body.data.filter((item) => item.id !== first.id).every((item) => item.coverImage === null),
    );
  });

  it('phân trang: page/pageSize, trang vượt quá → danh sách rỗng nhưng vẫn có total', async () => {
    const page2 = await list('admin', '?page=2&pageSize=2');
    assert.deepEqual(
      page2.data.map((item) => item.id),
      newestFirst().slice(2, 4),
    );
    assert.deepEqual(page2.meta, { page: 2, pageSize: 2, total: 5, totalPages: 3 });
    const beyond = await list('admin', '?page=9&pageSize=2');
    assert.deepEqual(beyond.data, []);
    assert.equal(beyond.meta.total, 5);
  });

  it('phạm vi OWN chỉ thấy BĐS của mình', async () => {
    const body = await list('ownOnly');
    assert.deepEqual(
      body.data.map((item) => item.id),
      newestFirst((entry) => entry.by === 'ownOnly'),
    );
    assert.equal(body.meta.total, 1);
  });

  it('địa chỉ và ownerId chỉ hiện với BĐS trong phạm vi xem liên hệ chủ nhà; toạ độ luôn có', async () => {
    const visibleTo = async (user: string): Promise<Record<string, boolean>> => {
      const body = await list(user);
      const result: Record<string, boolean> = {};
      for (const item of body.data) {
        assert.equal(item.latitude, 12.276543);
        assert.equal(item.streetAddress !== null, item.ownerContactVisible);
        const by = created.find((entry) => entry.id === item.id)?.by ?? '?';
        result[by] = (result[by] ?? false) || item.ownerContactVisible;
      }
      return result;
    };
    assert.deepEqual(await visibleTo('agent2'), {
      agent1: false,
      agent2: true,
      loner: false,
      ownOnly: false,
    });
    assert.deepEqual(await visibleTo('leader'), {
      agent1: true,
      agent2: true,
      loner: false,
      ownOnly: false,
    });
    assert.deepEqual(await visibleTo('admin'), {
      agent1: true,
      agent2: true,
      loner: true,
      ownOnly: true,
    });
  });

  it('tham số phân trang sai hoặc tham số lạ → 400', async () => {
    for (const query of ['?page=0', '?pageSize=101', '?page=abc', '?status=AVAILABLE']) {
      const response = await request('GET', `/properties${query}`, undefined, tokens['admin']);
      assert.equal(response.status, 400, query);
    }
  });

  it('chưa đăng nhập → 401; không có property.view → 403', async () => {
    assert.equal((await request('GET', '/properties')).status, 401);
    await db.query('DELETE FROM user_roles WHERE user_id = $1', [userIds['loner']]);
    app.get(PermissionService).invalidate(userIds['loner']);
    const response = await request('GET', '/properties', undefined, tokens['loner']);
    assert.equal(response.status, 403);
  });
});
