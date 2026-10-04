import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { hashPassword } from '../src/auth/password.js';
import { type StoredObject, StorageService } from '../src/storage/storage.service.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

interface Detail {
  id: string;
  updatedAt: string;
  updatedBy: string | null;
  agentId: string;
  ownerContactVisible: boolean;
  [key: string]: unknown;
}

interface Image {
  id: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  sortOrder: number;
  isCover: boolean;
}

interface Upload {
  imageId: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
}

interface ApiError {
  error: { code: string; details?: { field?: string }[] };
}

/**
 * Công ty A: admin; phòng D1 có `manager` (MANAGER), team T1 (trưởng nhóm `leader`) gồm agent1, agent2;
 * phòng D2 có agent4. Mỗi test dùng BĐS mới do agent1 tạo. Storage thay bằng bản giả trong bộ nhớ.
 */
describe('Ảnh BĐS /api/v1/properties/:id/images', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let tenantA: string;
  let khanhHoa: string;
  let nhaTrang: string;
  let vinhHai: string;
  const tokens: Record<string, string> = {};
  /** Object "đã upload" trên storage giả, theo key. */
  const stored = new Map<string, StoredObject>();
  const uploadKeys: string[] = [];
  const userIds: Record<string, string> = {};

  before(async () => {
    await useTestDatabase();
    app = await createApp();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    db = app.get(DataSource);
    const storage = app.get(StorageService);
    storage.createUploadUrl = (key: string, contentType: string) => {
      uploadKeys.push(key);
      return Promise.resolve({
        url: `https://storage.test/${key}?signed`,
        headers: { 'content-type': contentType },
        expiresAt: new Date(Date.now() + 900_000),
      });
    };
    storage.head = (key: string) => Promise.resolve(stored.get(key) ?? null);
    storage.readUrl = (key: string) => Promise.resolve(`https://cdn.test/${key}`);

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

  const JPEG = { mimeType: 'image/jpeg', sizeBytes: 1000 };
  const MB = 1024 * 1024;

  function images(id: string, user = 'agent1'): Promise<Response> {
    return request('GET', `/properties/${id}/images`, undefined, tokens[user]);
  }

  async function imageList(id: string, user = 'agent1'): Promise<Image[]> {
    const response = await images(id, user);
    assert.equal(response.status, 200);
    return ((await response.json()) as { data: Image[] }).data;
  }

  function requestUpload(id: string, payload: unknown, user = 'agent1'): Promise<Response> {
    return request('POST', `/properties/${id}/images/upload-url`, payload, tokens[user]);
  }

  function confirm(id: string, payload: unknown, user = 'agent1'): Promise<Response> {
    return request('POST', `/properties/${id}/images`, payload, tokens[user]);
  }

  /** Xin link, "upload" lên storage giả, xác nhận; trả về ảnh vừa ghi. */
  async function addImage(
    id: string,
    { mimeType = 'image/jpeg', sizeBytes = 1000 } = {},
    user = 'agent1',
  ): Promise<Image> {
    const response = await requestUpload(id, { mimeType, sizeBytes }, user);
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
    const upload = ((await response.json()) as { data: Upload }).data;
    stored.set(String(uploadKeys.at(-1)), { sizeBytes, contentType: mimeType });
    const confirmed = await confirm(id, { imageId: upload.imageId, mimeType }, user);
    assert.equal(confirmed.status, 201, JSON.stringify(await confirmed.clone().json()));
    return ((await confirmed.json()) as { data: Image }).data;
  }

  async function errorOf(response: Response, status: number): Promise<ApiError['error']> {
    assert.equal(response.status, status, JSON.stringify(await response.clone().json()));
    return ((await response.json()) as ApiError).error;
  }

  async function fieldsOf(response: Response): Promise<string[]> {
    const error = await errorOf(response, 400);
    assert.equal(error.code, 'VALIDATION_ERROR');
    return [...new Set((error.details ?? []).map((detail) => detail.field ?? ''))].sort();
  }

  async function seedImages(propertyId: string, count: number): Promise<void> {
    await db.query(
      `INSERT INTO property_images (tenant_id, property_id, storage_key, mime_type, size_bytes, sort_order)
       SELECT $1::uuid, $2::uuid, $1::text || '/properties/' || $2::text || '/seed-' || n || '.jpg', 'image/jpeg', 1, n
         FROM generate_series(1, $3::int) AS n`,
      [tenantA, propertyId, count],
    );
  }

  it('upload 3 bước: link đúng thư mục BĐS, xác nhận ghi ảnh; ảnh đầu là ảnh bìa, ảnh sau xếp cuối', async () => {
    const property = await createProperty();
    const response = await requestUpload(property.id, JPEG);
    assert.equal(response.status, 201);
    const upload = ((await response.json()) as { data: Upload }).data;
    const key = `${tenantA}/properties/${property.id}/${upload.imageId}.jpg`;
    assert.equal(uploadKeys.at(-1), key);
    assert.equal(upload.uploadUrl, `https://storage.test/${key}?signed`);
    assert.deepEqual(upload.headers, { 'content-type': 'image/jpeg' });
    assert.deepEqual(await imageList(property.id), [], 'chưa xác nhận thì chưa có ảnh');

    stored.set(key, { sizeBytes: 2345, contentType: 'image/jpeg' });
    const confirmed = await confirm(property.id, {
      imageId: upload.imageId,
      mimeType: 'image/jpeg',
      width: 1600,
      height: 1200,
    });
    assert.equal(confirmed.status, 201);
    const first = ((await confirmed.json()) as { data: Image }).data;
    assert.deepEqual(
      { ...first, createdAt: undefined },
      {
        id: upload.imageId,
        url: `https://cdn.test/${key}`,
        mimeType: 'image/jpeg',
        sizeBytes: 2345,
        width: 1600,
        height: 1200,
        sortOrder: 0,
        isCover: true,
        createdAt: undefined,
      },
    );
    const second = await addImage(property.id, { mimeType: 'image/png', sizeBytes: 10 * MB });
    assert.equal(second.sortOrder, 1);
    assert.equal(second.isCover, false);
    assert.ok(second.url.endsWith('.png'));
    const [row] = (await db.query('SELECT created_by FROM property_images WHERE id = $1', [
      second.id,
    ])) as { created_by: string }[];
    assert.equal(row?.created_by, userIds['agent1']);
    assert.deepEqual(
      (await imageList(property.id, 'agent4')).map((image) => image.id),
      [first.id, second.id],
      'ai xem được BĐS thì xem được ảnh',
    );
  });

  it('xác nhận khi chưa upload, sai định dạng, quá 10MB → 422; xác nhận lại → 409', async () => {
    const property = await createProperty();
    const upload = ((await (await requestUpload(property.id, JPEG)).json()) as { data: Upload })
      .data;
    const key = String(uploadKeys.at(-1));
    const payload = { imageId: upload.imageId, mimeType: 'image/jpeg' };
    assert.equal(
      (await errorOf(await confirm(property.id, payload), 422)).code,
      'BUSINESS_RULE_VIOLATION',
    );
    stored.set(key, { sizeBytes: 100, contentType: 'image/png' });
    assert.equal(
      (await errorOf(await confirm(property.id, payload), 422)).code,
      'BUSINESS_RULE_VIOLATION',
    );
    stored.set(key, { sizeBytes: 10 * MB + 1, contentType: 'image/jpeg' });
    assert.equal(
      (await errorOf(await confirm(property.id, payload), 422)).code,
      'BUSINESS_RULE_VIOLATION',
    );
    stored.set(key, { sizeBytes: 100, contentType: 'image/jpeg' });
    assert.equal((await confirm(property.id, payload)).status, 201);
    assert.equal((await errorOf(await confirm(property.id, payload), 409)).code, 'CONFLICT');
    assert.equal((await imageList(property.id)).length, 1);
  });

  it('dữ liệu sai → 400: định dạng ngoài jpeg/png/webp/heic, quá 10MB, thiếu trường, trường lạ', async () => {
    const property = await createProperty();
    assert.deepEqual(await fieldsOf(await requestUpload(property.id, {})), [
      'mimeType',
      'sizeBytes',
    ]);
    for (const mimeType of ['image/gif', 'application/pdf', 'IMAGE/JPEG']) {
      assert.deepEqual(
        await fieldsOf(await requestUpload(property.id, { ...JPEG, mimeType })),
        ['mimeType'],
        mimeType,
      );
    }
    for (const sizeBytes of [0, 10 * MB + 1, 1.5, '100']) {
      assert.deepEqual(
        await fieldsOf(await requestUpload(property.id, { ...JPEG, sizeBytes })),
        ['sizeBytes'],
        String(sizeBytes),
      );
    }
    assert.deepEqual(
      await fieldsOf(await requestUpload(property.id, { ...JPEG, storageKey: 'x' })),
      ['storageKey'],
    );
    assert.deepEqual(
      await fieldsOf(
        await confirm(property.id, { imageId: 'abc', mimeType: 'image/jpeg', width: 0 }),
      ),
      ['imageId', 'width'],
    );
  });

  it('tối đa 30 ảnh mỗi BĐS → 422 khi xin link và khi xác nhận', async () => {
    const property = await createProperty();
    await seedImages(property.id, 29);
    const upload = ((await (await requestUpload(property.id, JPEG)).json()) as { data: Upload })
      .data;
    stored.set(String(uploadKeys.at(-1)), { sizeBytes: 100, contentType: 'image/jpeg' });
    await addImage(property.id);
    assert.equal(
      (await errorOf(await requestUpload(property.id, JPEG), 422)).code,
      'BUSINESS_RULE_VIOLATION',
    );
    const late = await confirm(property.id, { imageId: upload.imageId, mimeType: 'image/jpeg' });
    assert.equal((await errorOf(late, 422)).code, 'BUSINESS_RULE_VIOLATION');
    assert.equal((await imageList(property.id)).length, 30);
  });

  it('sắp xếp lại: phải gửi đúng toàn bộ ảnh hiện có', async () => {
    const property = await createProperty();
    const [a, b, c] = [
      await addImage(property.id),
      await addImage(property.id),
      await addImage(property.id),
    ];
    assert.ok(a && b && c);
    const reorder = (imageIds: unknown, user = 'agent1'): Promise<Response> =>
      request('PUT', `/properties/${property.id}/images/order`, { imageIds }, tokens[user]);
    const response = await reorder([c.id, a.id, b.id]);
    assert.equal(response.status, 200);
    const data = ((await response.json()) as { data: Image[] }).data;
    assert.deepEqual(
      data.map((image) => [image.id, image.sortOrder]),
      [
        [c.id, 0],
        [a.id, 1],
        [b.id, 2],
      ],
    );
    assert.equal(data.find((image) => image.isCover)?.id, a.id, 'thứ tự không đổi ảnh bìa');
    for (const imageIds of [
      [a.id, b.id],
      [a.id, b.id, c.id, property.id],
      [a.id, a.id, b.id],
      'x',
    ]) {
      assert.deepEqual(
        await fieldsOf(await reorder(imageIds)),
        ['imageIds'],
        JSON.stringify(imageIds),
      );
    }
    assert.equal((await reorder([a.id, b.id, c.id], 'agent2')).status, 403);
  });

  it('đổi ảnh bìa; ảnh không thuộc BĐS → 404', async () => {
    const property = await createProperty();
    const a = await addImage(property.id);
    const b = await addImage(property.id);
    const response = await request(
      'POST',
      `/properties/${property.id}/images/${b.id}/cover`,
      undefined,
      tokens['leader'],
    );
    assert.equal(response.status, 200);
    const data = ((await response.json()) as { data: Image[] }).data;
    assert.deepEqual(
      data.map((image) => image.isCover),
      [false, true],
    );
    const other = await createProperty();
    const foreign = await addImage(other.id);
    assert.equal(
      (
        await request(
          'POST',
          `/properties/${property.id}/images/${foreign.id}/cover`,
          undefined,
          tokens['agent1'],
        )
      ).status,
      404,
    );
    assert.equal((await imageList(property.id)).find((image) => image.isCover)?.id, b.id);
    assert.ok(a);
  });

  it('xoá ảnh → 204, xoá mềm; xoá ảnh bìa thì ảnh đầu còn lại thành ảnh bìa', async () => {
    const property = await createProperty();
    const a = await addImage(property.id);
    const b = await addImage(property.id);
    const c = await addImage(property.id);
    const remove = (imageId: string, user = 'agent1'): Promise<Response> =>
      request('DELETE', `/properties/${property.id}/images/${imageId}`, undefined, tokens[user]);
    assert.equal((await remove(b.id)).status, 204);
    assert.equal((await remove(a.id)).status, 204);
    const left = await imageList(property.id);
    assert.deepEqual(
      left.map((image) => [image.id, image.isCover]),
      [[c.id, true]],
    );
    const [row] = (await db.query('SELECT deleted_at FROM property_images WHERE id = $1', [
      a.id,
    ])) as {
      deleted_at: Date | null;
    }[];
    assert.ok(row?.deleted_at);
    assert.equal((await remove(a.id)).status, 404, 'đã xoá');
    assert.equal((await remove(c.id, 'agent2')).status, 403);
    assert.equal((await remove(c.id, 'manager')).status, 204);
    assert.deepEqual(await imageList(property.id), []);
  });

  it('ngoài phạm vi sửa → 403 khi xin link/xác nhận; BĐS không xem được, công ty khác → 404', async () => {
    const property = await createProperty();
    for (const user of ['agent2', 'agent4']) {
      assert.equal(
        (await errorOf(await requestUpload(property.id, JPEG, user), 403)).code,
        'FORBIDDEN',
        user,
      );
    }
    const upload = ((await (await requestUpload(property.id, JPEG)).json()) as { data: Upload })
      .data;
    stored.set(String(uploadKeys.at(-1)), { sizeBytes: 100, contentType: 'image/jpeg' });
    const payload = { imageId: upload.imageId, mimeType: 'image/jpeg' };
    assert.equal((await confirm(property.id, payload, 'agent2')).status, 403);
    assert.equal((await addImage(property.id, {}, 'leader')).isCover, true);

    await db.query(`UPDATE properties SET status = 'HIDDEN' WHERE id = $1`, [property.id]);
    assert.equal((await images(property.id, 'agent2')).status, 404);
    assert.equal((await requestUpload(property.id, JPEG, 'agent2')).status, 404);
    assert.equal((await images(property.id, 'agent1')).status, 200);

    const other = await createProperty('_', await login('admin@b.vn'));
    assert.equal((await images(other.id, 'admin')).status, 404);
    assert.equal((await requestUpload(other.id, JPEG, 'admin')).status, 404);
    assert.equal((await images('00000000-0000-4000-8000-000000000000')).status, 404);
    assert.equal((await images('abc')).status, 400);
    assert.equal((await request('GET', `/properties/${property.id}/images`)).status, 401);
  });
});
