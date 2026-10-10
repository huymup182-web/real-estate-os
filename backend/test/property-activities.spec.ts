import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { hashPassword } from '../src/auth/password.js';
import { PermissionService } from '../src/auth/permission.service.js';
import { PropertiesService } from '../src/properties/properties.service.js';
import { PropertyImagesService } from '../src/properties/property-images.service.js';
import { StorageService } from '../src/storage/storage.service.js';
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
 * phòng D2 có agent4. Mỗi test dùng BĐS mới do agent1 tạo. Storage giả: file nào cũng "đã upload".
 */
describe('Nhật ký hoạt động BĐS GET /api/v1/properties/:id/activities', () => {
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
    const storage = app.get(StorageService);
    storage.head = (key: string) =>
      Promise.resolve({
        sizeBytes: 1000,
        contentType: key.endsWith('.pdf') ? 'application/pdf' : 'image/webp',
      });
    storage.readUrl = (key: string) => Promise.resolve(`https://cdn.test/${key}`);
    storage.signedReadUrl = (key: string) => Promise.resolve(`https://storage.test/${key}`);
    storage.getObject = () => Promise.reject(new Error('không có file'));
  });

  after(async () => {
    await app.get(PropertyImagesService).waitForThumbnails();
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

  async function createProperty(user = 'agent1', token = tokens[user]): Promise<Detail> {
    const response = await request(
      'POST',
      '/properties',
      {
        title: 'Nhà phố Vĩnh Hải',
        description: 'Gần biển',
        propertyType: 'HOUSE',
        price: 3_500_000_000,
        area: 70,
        provinceId: khanhHoa,
        districtId: nhaTrang,
        wardId: vinhHai,
        streetAddress: '12 Đường 2/4',
        latitude: 12.276543,
        longitude: 109.198765,
        commissionType: 'PERCENT',
        commissionValue: 1.5,
      },
      token,
    );
    assert.equal(response.status, 201);
    return ((await response.json()) as { data: Detail }).data;
  }

  interface Activity {
    id: string;
    action: string;
    changes: Record<string, [unknown, unknown]> | null;
    user: { id: string; fullName: string } | null;
    createdAt: string;
  }

  async function activities(
    id: string,
    user = 'agent1',
    query = 'pageSize=100',
  ): Promise<{ data: Activity[]; meta: { total: number } }> {
    const response = await request(
      'GET',
      `/properties/${id}/activities?${query}`,
      undefined,
      tokens[user],
    );
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    return (await response.json()) as { data: Activity[]; meta: { total: number } };
  }

  async function call(
    method: string,
    path: string,
    payload: unknown,
    expected: number,
    user = 'agent1',
  ): Promise<Record<string, unknown>> {
    const response = await request(method, path, payload, tokens[user]);
    assert.equal(response.status, expected, `${method} ${path}: ${await response.clone().text()}`);
    return expected === 204
      ? {}
      : ((await response.json()) as { data: Record<string, unknown> }).data;
  }

  it('ghi mọi thao tác trên BĐS, mới trước, kèm người làm và thay đổi {field: [cũ, mới]}', async () => {
    const property = await createProperty();
    const base = `/properties/${property.id}`;
    await call('PATCH', base, { price: 4_000_000_000, title: 'Nhà phố Vĩnh Hải' }, 200);
    await call('PATCH', base, { title: 'Nhà phố Vĩnh Hải' }, 200);
    await call('POST', `${base}/status`, { status: 'PENDING' }, 200);
    await call('PUT', `${base}/owner`, { fullName: 'Chủ nhà', phone: '+84905000111' }, 200);
    await call('POST', `${base}/verify`, {}, 200);
    const firstImage = randomUUID();
    const secondImage = randomUUID();
    await call('POST', `${base}/images`, { imageId: firstImage, mimeType: 'image/webp' }, 201);
    await call('POST', `${base}/images`, { imageId: secondImage, mimeType: 'image/webp' }, 201);
    await call('PUT', `${base}/images/order`, { imageIds: [secondImage, firstImage] }, 200);
    await call('POST', `${base}/images/${secondImage}/cover`, {}, 200);
    await call('DELETE', `${base}/images/${firstImage}`, undefined, 204);
    const documentId = randomUUID();
    await call(
      'POST',
      `${base}/documents`,
      {
        documentId,
        documentType: 'LAND_CERTIFICATE',
        fileName: 'so-do Nguyen Van A.pdf',
        mimeType: 'application/pdf',
      },
      201,
    );
    await call('DELETE', `${base}/documents/${documentId}`, undefined, 204);
    const link = await call('POST', `${base}/share-links`, {}, 201);
    await call('DELETE', `${base}/share-links/${String(link['id'])}`, undefined, 204);
    await call('DELETE', `${base}/share-links/${String(link['id'])}`, undefined, 204);
    await call('POST', `${base}/assign`, { agentId: userIds['agent2'] }, 200, 'leader');
    await call('DELETE', `${base}/owner`, undefined, 204, 'leader');

    const { data, meta } = await activities(property.id, 'leader');
    assert.equal(meta.total, 16, 'sửa không đổi gì và thu hồi lần hai không ghi');
    const ownerSet = data.find((item) => item.action === 'property.set_owner');
    const ownerId = ownerSet?.changes?.['ownerId']?.[1];
    assert.equal(typeof ownerId, 'string');
    assert.deepEqual(
      data.map((item) => [item.action, item.changes, item.user?.fullName]).reverse(),
      [
        ['property.create', null, 'agent1'],
        ['property.update', { price: [3_500_000_000, 4_000_000_000] }, 'agent1'],
        ['property.change_status', { status: ['AVAILABLE', 'PENDING'] }, 'agent1'],
        ['property.set_owner', { ownerId: [null, ownerId] }, 'agent1'],
        ['property.verify', { verificationStatus: ['UNVERIFIED', 'VERIFIED'] }, 'agent1'],
        ['property.add_image', { imageId: [null, firstImage] }, 'agent1'],
        ['property.add_image', { imageId: [null, secondImage] }, 'agent1'],
        [
          'property.reorder_images',
          {
            imageIds: [
              [firstImage, secondImage],
              [secondImage, firstImage],
            ],
          },
          'agent1',
        ],
        ['property.set_cover_image', { coverImageId: [firstImage, secondImage] }, 'agent1'],
        ['property.remove_image', { imageId: [firstImage, null] }, 'agent1'],
        [
          'property.add_document',
          { documentId: [null, documentId], documentType: [null, 'LAND_CERTIFICATE'] },
          'agent1',
        ],
        [
          'property.remove_document',
          { documentId: [documentId, null], documentType: ['LAND_CERTIFICATE', null] },
          'agent1',
        ],
        ['property.create_share_link', { shareLinkId: [null, link['id']] }, 'agent1'],
        ['property.revoke_share_link', { shareLinkId: [link['id'], null] }, 'agent1'],
        ['property.assign', { agentId: [userIds['agent1'], userIds['agent2']] }, 'leader'],
        ['property.remove_owner', { ownerId: [ownerId, null] }, 'leader'],
      ],
    );
    assert.equal(data[0]?.user?.id, userIds['leader']);
    const body = JSON.stringify(data);
    for (const secret of ['+84905000111', 'Chủ nhà', 'Nguyen Van A']) {
      assert.ok(!body.includes(secret), secret);
    }
    assert.ok(!('ipAddress' in (data[0] ?? {})));

    const [row] = (await db.query(
      `SELECT tenant_id, user_id, entity_type, request_id, host(ip_address) AS ip, user_agent
         FROM audit_logs WHERE entity_id = $1 AND action = 'property.create'`,
      [property.id],
    )) as Record<string, string>[];
    assert.equal(row?.['tenant_id'], tenantA);
    assert.equal(row?.['user_id'], userIds['agent1']);
    assert.equal(row?.['entity_type'], 'property');
    assert.ok(row?.['request_id']);
    assert.equal(row?.['ip'], '127.0.0.1');
    assert.ok(row?.['user_agent']);
  });

  it('chỉ người sửa được BĐS xem nhật ký: xem được mà không sửa được → 403; công ty khác, không có → 404; id sai → 400; chưa đăng nhập → 401', async () => {
    const property = await createProperty();
    assert.equal((await activities(property.id, 'manager')).meta.total, 1);
    assert.equal((await activities(property.id, 'admin')).meta.total, 1);
    const path = `/properties/${property.id}/activities`;
    assert.equal((await request('GET', path, undefined, tokens['agent2'])).status, 403);
    assert.equal((await request('GET', path, undefined, tokens['agent4'])).status, 403);
    assert.equal((await request('GET', path, undefined, tokens['adminB'])).status, 404);
    assert.equal(
      (
        await request(
          'GET',
          '/properties/00000000-0000-4000-8000-000000000000/activities',
          undefined,
          tokens['agent1'],
        )
      ).status,
      404,
    );
    assert.equal(
      (await request('GET', '/properties/abc/activities', undefined, tokens['agent1'])).status,
      400,
    );
    assert.equal((await request('GET', path)).status, 401);
    assert.equal(
      (await request('GET', `${path}?pageSize=1000`, undefined, tokens['agent1'])).status,
      400,
    );
  });

  it('phân trang; BĐS đã xoá thì không xem nhật ký được nữa nhưng nhật ký vẫn còn trong database', async () => {
    const property = await createProperty();
    for (const price of [1_000_000_000, 2_000_000_000, 3_000_000_000]) {
      await call('PATCH', `/properties/${property.id}`, { price }, 200);
    }
    const page = await activities(property.id, 'agent1', 'page=2&pageSize=2');
    assert.equal(page.meta.total, 4);
    assert.deepEqual(
      page.data.map((item) => [item.action, item.changes?.['price']?.[1] ?? null]),
      [
        ['property.update', 1_000_000_000],
        ['property.create', null],
      ],
    );
    await call('DELETE', `/properties/${property.id}`, undefined, 204, 'admin');
    const response = await request(
      'GET',
      `/properties/${property.id}/activities`,
      undefined,
      tokens['admin'],
    );
    assert.equal(response.status, 404);
    const rows = (await db.query(
      `SELECT action, user_id FROM audit_logs WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [property.id],
    )) as { action: string; user_id: string }[];
    assert.deepEqual(rows, [{ action: 'property.delete', user_id: userIds['admin'] }]);
  });

  it('địa chỉ chi tiết, toạ độ trong nhật ký chỉ hiện với người xem được liên hệ chủ nhà', async () => {
    const property = await createProperty();
    await call(
      'PATCH',
      `/properties/${property.id}`,
      { streetAddress: '99 Trần Phú', latitude: 12.25, longitude: 109.2 },
      200,
    );
    await call('PATCH', `/properties/${property.id}`, { streetAddress: '1 Lê Lợi', price: 5 }, 200);
    const full = await activities(property.id, 'manager');
    assert.deepEqual(full.data[1]?.changes, {
      streetAddress: ['12 Đường 2/4', '99 Trần Phú'],
      latitude: [12.276543, 12.25],
      longitude: [109.198765, 109.2],
    });
    await db.query(
      `DELETE FROM role_permissions rp USING roles r, permissions p
        WHERE rp.role_id = r.id AND rp.permission_id = p.id
          AND r.tenant_id = $1 AND r.code = 'MANAGER' AND p.code = 'property.view_owner_contact'`,
      [tenantA],
    );
    app.get(PermissionService).invalidate();
    try {
      const limited = await activities(property.id, 'manager');
      assert.equal(limited.meta.total, 3);
      assert.deepEqual(
        limited.data.map((item) => item.changes),
        [{ price: [3_500_000_000, 5] }, null, null],
      );
      assert.ok(!JSON.stringify(limited.data).includes('Trần Phú'));
    } finally {
      await db.query(
        `INSERT INTO role_permissions (role_id, permission_id, scope)
         SELECT r.id, p.id, 'DEPARTMENT' FROM roles r, permissions p
          WHERE r.tenant_id = $1 AND r.code = 'MANAGER' AND p.code = 'property.view_owner_contact'`,
        [tenantA],
      );
      app.get(PermissionService).invalidate();
    }
  });

  it('job quá hạn xác minh ghi nhật ký không có người làm', async () => {
    const service = app.get(PropertiesService);
    await service.markOverdueForVerification();
    const property = await createProperty();
    await db.query(`UPDATE properties SET created_at = now() - interval '40 days' WHERE id = $1`, [
      property.id,
    ]);
    assert.equal(await service.markOverdueForVerification(), 1);
    const { data } = await activities(property.id);
    assert.deepEqual(
      [data[0]?.action, data[0]?.changes, data[0]?.user],
      [
        'property.verification_expired',
        { status: ['AVAILABLE', 'VERIFY_REQUIRED'], verificationStatus: ['UNVERIFIED', 'EXPIRED'] },
        null,
      ],
    );
  });
});
