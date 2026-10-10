import 'reflect-metadata';

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { hashPassword } from '../src/auth/password.js';
import { StorageService } from '../src/storage/storage.service.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

interface LinkItem {
  id: string;
  createdBy: string | null;
  expiresAt: string;
  revokedAt: string | null;
  viewCount: number;
  active: boolean;
  createdAt: string;
}

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
 * phòng D2 có agent4. Mỗi test dùng BĐS mới do agent1 tạo. Storage giả: ảnh trả link CDN theo key.
 */
describe('Link chia sẻ BĐS /api/v1/properties/:id/share-links, /api/v1/shared-properties/:token', () => {
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
    await db.query(`UPDATE users SET phone = '+84905123456' WHERE id = $1`, [userIds['agent1']]);
    const storage = app.get(StorageService);
    storage.readUrl = (key: string) => Promise.resolve(`https://cdn.test/${key}`);
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

  async function createLink(
    propertyId: string,
    user = 'agent2',
    payload: unknown = {},
  ): Promise<{ id: string; token: string; expiresAt: string; createdAt: string }> {
    const response = await request(
      'POST',
      `/properties/${propertyId}/share-links`,
      payload,
      tokens[user],
    );
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
    return (
      (await response.json()) as {
        data: { id: string; token: string; expiresAt: string; createdAt: string };
      }
    ).data;
  }

  async function links(propertyId: string, user = 'agent2'): Promise<LinkItem[]> {
    const response = await request(
      'GET',
      `/properties/${propertyId}/share-links`,
      undefined,
      tokens[user],
    );
    assert.equal(response.status, 200);
    return ((await response.json()) as { data: LinkItem[] }).data;
  }

  function shared(token: string): Promise<Response> {
    return request('GET', `/shared-properties/${token}`);
  }

  async function sharedData(token: string): Promise<Record<string, unknown>> {
    const response = await shared(token);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    return ((await response.json()) as { data: Record<string, unknown> }).data;
  }

  it('tạo link → 201 token 43 ký tự, hạn mặc định 30 ngày; database chỉ lưu SHA-256 của token', async () => {
    const property = await createProperty();
    const link = await createLink(property.id);
    assert.match(link.token, /^[A-Za-z0-9_-]{43}$/);
    const days =
      (new Date(link.expiresAt).getTime() - new Date(link.createdAt).getTime()) / 86_400_000;
    assert.ok(Math.abs(days - 30) < 0.01, String(days));
    const [row] = (await db.query(
      'SELECT token_hash, created_by FROM property_share_links WHERE id = $1',
      [link.id],
    )) as { token_hash: string; created_by: string }[];
    assert.equal(row?.token_hash, createHash('sha256').update(link.token).digest('hex'));
    assert.equal(row?.created_by, userIds['agent2']);
    const custom = await createLink(property.id, 'agent2', { expiresInDays: 1 });
    const customDays =
      (new Date(custom.expiresAt).getTime() - new Date(custom.createdAt).getTime()) / 86_400_000;
    assert.ok(Math.abs(customDays - 1) < 0.01);
  });

  it('expiresInDays sai → 400; BĐS đang ẩn → 422; không xem được BĐS, công ty khác → 404; chưa đăng nhập → 401', async () => {
    const property = await createProperty();
    for (const expiresInDays of [0, 91, 1.5, '7']) {
      const response = await request(
        'POST',
        `/properties/${property.id}/share-links`,
        { expiresInDays },
        tokens['agent2'],
      );
      assert.equal(response.status, 400, String(expiresInDays));
    }
    const hidden = await createProperty();
    await db.query(`UPDATE properties SET status = 'HIDDEN' WHERE id = $1`, [hidden.id]);
    const hiddenByEditor = await request(
      'POST',
      `/properties/${hidden.id}/share-links`,
      {},
      tokens['agent1'],
    );
    assert.equal(hiddenByEditor.status, 422);
    const hiddenByViewer = await request(
      'POST',
      `/properties/${hidden.id}/share-links`,
      {},
      tokens['agent2'],
    );
    assert.equal(hiddenByViewer.status, 404);
    const other = await createProperty('_', await login('admin@b.vn'));
    assert.equal(
      (await request('POST', `/properties/${other.id}/share-links`, {}, tokens['agent2'])).status,
      404,
    );
    assert.equal(
      (await request('GET', `/properties/${other.id}/share-links`, undefined, tokens['agent2']))
        .status,
      404,
    );
    assert.equal((await request('POST', `/properties/${property.id}/share-links`, {})).status, 401);
  });

  it('khách mở link không cần đăng nhập: thấy thông tin giới hạn, ảnh, môi giới tạo link; không lộ chủ nhà, địa chỉ, toạ độ, hoa hồng', async () => {
    const property = await createProperty();
    await db.query(
      `INSERT INTO property_images (tenant_id, property_id, storage_key, thumbnail_key, mime_type,
                                    size_bytes, sort_order, is_cover)
       VALUES ($1, $2, $3, $4, 'image/webp', 100, 0, true),
              ($1, $2, $5, NULL, 'image/webp', 100, 1, false)`,
      [
        tenantA,
        property.id,
        `${tenantA}/properties/${property.id}/a.webp`,
        `${tenantA}/properties/${property.id}/a_thumb.webp`,
        `${tenantA}/properties/${property.id}/b.webp`,
      ],
    );
    const link = await createLink(property.id, 'agent1');
    const data = await sharedData(link.token);
    assert.deepEqual(Object.keys(data).sort(), [
      'agent',
      'area',
      'bathrooms',
      'bedrooms',
      'code',
      'description',
      'direction',
      'districtName',
      'expiresAt',
      'floors',
      'images',
      'legalStatus',
      'price',
      'pricePerM2',
      'propertyType',
      'provinceName',
      'roadAccess',
      'roadWidth',
      'status',
      'title',
      'transactionType',
      'wardName',
    ]);
    assert.equal(data['title'], 'Nhà phố Vĩnh Hải');
    assert.equal(data['price'], 3_500_000_000);
    assert.equal(data['area'], 70);
    assert.equal(data['pricePerM2'], 50_000_000);
    assert.equal(data['provinceName'], 'Khánh Hòa');
    assert.equal(data['districtName'], 'Nha Trang');
    assert.equal(data['wardName'], 'Vĩnh Hải');
    assert.deepEqual(data['agent'], {
      fullName: 'agent1',
      phone: '+84905123456',
      email: 'agent1@a.vn',
    });
    assert.deepEqual(data['images'], [
      {
        url: `https://cdn.test/${tenantA}/properties/${property.id}/a.webp`,
        thumbnailUrl: `https://cdn.test/${tenantA}/properties/${property.id}/a_thumb.webp`,
        width: null,
        height: null,
        isCover: true,
      },
      {
        url: `https://cdn.test/${tenantA}/properties/${property.id}/b.webp`,
        thumbnailUrl: null,
        width: null,
        height: null,
        isCover: false,
      },
    ]);
    // Ảnh nằm theo key storage (có id công ty, BĐS); các trường còn lại không lộ id hay địa chỉ.
    const body = JSON.stringify({ ...data, images: [] });
    for (const secret of ['12 Đường 2/4', '109.19', '12.27', property.id, tenantA]) {
      assert.ok(!body.includes(secret), secret);
    }
  });

  it('mỗi lần khách mở link tăng lượt xem; danh sách: người sửa thấy mọi link, người khác chỉ link mình, không có token', async () => {
    const property = await createProperty();
    const mine = await createLink(property.id, 'agent2');
    const theirs = await createLink(property.id, 'agent4');
    await sharedData(mine.token);
    await sharedData(mine.token);
    const own = await links(property.id, 'agent2');
    assert.deepEqual(
      own.map((item) => item.id),
      [mine.id],
    );
    assert.equal(own[0]?.viewCount, 2);
    assert.equal(own[0]?.active, true);
    assert.equal(own[0]?.createdBy, userIds['agent2']);
    assert.ok(!('token' in (own[0] ?? {})));
    assert.deepEqual(
      (await links(property.id, 'agent1')).map((item) => item.id),
      [theirs.id, mine.id],
    );
  });

  it('thu hồi: người tạo hoặc người sửa được BĐS → 204 (gọi lại vẫn 204); người khác → 403; link không có → 404; link thu hồi thì khách nhận 404', async () => {
    const property = await createProperty();
    const first = await createLink(property.id, 'agent2');
    const second = await createLink(property.id, 'agent2');
    const path = (id: string): string => `/properties/${property.id}/share-links/${id}`;
    assert.equal(
      (await request('DELETE', path(first.id), undefined, tokens['agent4'])).status,
      403,
    );
    assert.equal(
      (await request('DELETE', path(first.id), undefined, tokens['agent2'])).status,
      204,
    );
    assert.equal(
      (await request('DELETE', path(first.id), undefined, tokens['agent2'])).status,
      204,
    );
    assert.equal(
      (await request('DELETE', path(second.id), undefined, tokens['manager'])).status,
      204,
    );
    assert.equal(
      (
        await request(
          'DELETE',
          path('00000000-0000-4000-8000-000000000000'),
          undefined,
          tokens['agent2'],
        )
      ).status,
      404,
    );
    assert.equal((await request('DELETE', path('abc'), undefined, tokens['agent2'])).status, 400);
    assert.equal((await shared(first.token)).status, 404);
    assert.equal((await shared(second.token)).status, 404);
    const list = await links(property.id, 'agent2');
    assert.ok(list.every((item) => item.revokedAt !== null && !item.active));
    const other = await createProperty();
    assert.equal(
      (
        await request(
          'DELETE',
          `/properties/${other.id}/share-links/${first.id}`,
          undefined,
          tokens['agent2'],
        )
      ).status,
      404,
      'link của BĐS khác',
    );
  });

  it('khách nhận 404 khi: token sai dạng hoặc không có, link hết hạn, BĐS ẩn hoặc đã xoá, công ty tạm dừng, người tạo link bị khoá', async () => {
    assert.equal((await shared('abc')).status, 404);
    assert.equal((await shared('A'.repeat(43))).status, 404);

    const property = await createProperty();
    const expired = await createLink(property.id);
    await db.query(
      `UPDATE property_share_links SET created_at = now() - interval '2 days',
                                        expires_at = now() - interval '1 second' WHERE id = $1`,
      [expired.id],
    );
    assert.equal((await shared(expired.token)).status, 404);
    assert.equal((await links(property.id)).find((item) => item.id === expired.id)?.active, false);

    const link = await createLink(property.id);
    await db.query(`UPDATE properties SET status = 'HIDDEN' WHERE id = $1`, [property.id]);
    assert.equal((await shared(link.token)).status, 404);
    await db.query(`UPDATE properties SET status = 'AVAILABLE' WHERE id = $1`, [property.id]);
    assert.equal((await shared(link.token)).status, 200);

    await db.query(`UPDATE users SET status = 'LOCKED' WHERE id = $1`, [userIds['agent2']]);
    assert.equal((await shared(link.token)).status, 404);
    await db.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [userIds['agent2']]);

    await db.query(`UPDATE companies SET status = 'SUSPENDED' WHERE id = $1`, [tenantA]);
    assert.equal((await shared(link.token)).status, 404);
    await db.query(`UPDATE companies SET status = 'ACTIVE' WHERE id = $1`, [tenantA]);
    assert.equal((await shared(link.token)).status, 200);

    assert.equal(
      (await request('DELETE', `/properties/${property.id}`, undefined, tokens['admin'])).status,
      204,
    );
    assert.equal((await shared(link.token)).status, 404);
    const [row] = (await db.query('SELECT view_count FROM property_share_links WHERE id = $1', [
      link.id,
    ])) as { view_count: number }[];
    assert.equal(row?.view_count, 2, 'chỉ đếm lần mở thành công');
  });
});
