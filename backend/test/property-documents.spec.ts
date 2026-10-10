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

interface Document {
  id: string;
  documentType: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdBy: string | null;
}

interface Upload {
  documentId: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
}

interface ApiError {
  error: { code: string; details?: { field?: string }[] };
}

/**
 * Công ty A: admin; phòng D1 có `manager` (MANAGER), team T1 (trưởng nhóm `leader`) gồm agent1, agent2;
 * phòng D2 có agent4; `noDocs` (role tuỳ chỉnh: xem/tạo/sửa BĐS phạm vi OWN, không xem giấy tờ);
 * `noContact` (như noDocs nhưng xem được giấy tờ, không xem liên hệ chủ nhà).
 * Mỗi test dùng BĐS mới do agent1 tạo. Storage thay bằng bản giả trong bộ nhớ.
 */
describe('Giấy tờ BĐS /api/v1/properties/:id/documents', () => {
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
    storage.readUrl = () => Promise.reject(new Error('giấy tờ không được đọc qua CDN'));
    storage.signedReadUrl = (key: string, ttl: number, name?: string) =>
      Promise.resolve(
        `https://storage.test/${key}?ttl=${ttl}&name=${encodeURIComponent(name ?? '')}`,
      );

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
    for (const [code, permissions] of [
      ['NO_DOCS', ['property.view', 'property.create', 'property.edit']],
      [
        'NO_CONTACT',
        ['property.view', 'property.create', 'property.edit', 'property.view_documents'],
      ],
    ] as const) {
      const role = await insertId(`INSERT INTO roles (tenant_id, code, name) VALUES ($1, $2, $2)`, [
        tenantA,
        code,
      ]);
      await db.query(
        `INSERT INTO role_permissions (role_id, permission_id, scope)
         SELECT $1, id, 'OWN' FROM permissions WHERE code = ANY($2::text[])`,
        [role, permissions],
      );
    }
    userIds['noDocs'] = await insertUser('noDocs', hash, null, 'NO_DOCS');
    userIds['noContact'] = await insertUser('noContact', hash, null, 'NO_CONTACT');

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

  const PDF = {
    documentType: 'LAND_CERTIFICATE',
    fileName: 'Sổ hồng.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1000,
  };
  const MB = 1024 * 1024;

  function documents(id: string, user = 'agent1'): Promise<Response> {
    return request('GET', `/properties/${id}/documents`, undefined, tokens[user]);
  }

  async function documentList(id: string, user = 'agent1'): Promise<Document[]> {
    const response = await documents(id, user);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    return ((await response.json()) as { data: Document[] }).data;
  }

  function requestUpload(id: string, payload: unknown, user = 'agent1'): Promise<Response> {
    return request('POST', `/properties/${id}/documents/upload-url`, payload, tokens[user]);
  }

  function confirm(id: string, payload: unknown, user = 'agent1'): Promise<Response> {
    return request('POST', `/properties/${id}/documents`, payload, tokens[user]);
  }

  function remove(id: string, documentId: string, user = 'agent1'): Promise<Response> {
    return request('DELETE', `/properties/${id}/documents/${documentId}`, undefined, tokens[user]);
  }

  /** Body xác nhận: thông tin file đã khai báo (trừ kích thước) và `documentId`. */
  function confirmPayload(file: typeof PDF, documentId: string): Record<string, string> {
    return {
      documentType: file.documentType,
      fileName: file.fileName,
      mimeType: file.mimeType,
      documentId,
    };
  }

  /** Xin link, "upload" lên storage giả, xác nhận; trả về giấy tờ vừa ghi. */
  async function addDocument(id: string, overrides = {}, user = 'agent1'): Promise<Document> {
    const file = { ...PDF, ...overrides };
    const response = await requestUpload(id, file, user);
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
    const upload = ((await response.json()) as { data: Upload }).data;
    stored.set(String(uploadKeys.at(-1)), {
      sizeBytes: file.sizeBytes,
      contentType: file.mimeType,
    });
    const confirmed = await confirm(id, confirmPayload(file, upload.documentId), user);
    assert.equal(confirmed.status, 201, JSON.stringify(await confirmed.clone().json()));
    return ((await confirmed.json()) as { data: Document }).data;
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

  it('upload 3 bước vào thư mục documents; danh sách mới trước, link tải ký riêng 5 phút kèm tên file', async () => {
    const property = await createProperty();
    const response = await requestUpload(property.id, PDF);
    assert.equal(response.status, 201);
    const upload = ((await response.json()) as { data: Upload }).data;
    const key = `${tenantA}/properties/${property.id}/documents/${upload.documentId}.pdf`;
    assert.equal(uploadKeys.at(-1), key);
    assert.deepEqual(upload.headers, { 'content-type': 'application/pdf' });
    assert.deepEqual(await documentList(property.id), []);

    stored.set(key, { sizeBytes: 4321, contentType: 'application/pdf' });
    const confirmed = await confirm(property.id, {
      documentId: upload.documentId,
      documentType: 'LAND_CERTIFICATE',
      fileName: '  Sổ hồng.pdf ',
      mimeType: 'application/pdf',
    });
    assert.equal(confirmed.status, 201);
    const first = ((await confirmed.json()) as { data: Document }).data;
    assert.deepEqual(
      { ...first, createdAt: undefined },
      {
        id: upload.documentId,
        documentType: 'LAND_CERTIFICATE',
        fileName: 'Sổ hồng.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 4321,
        url: `https://storage.test/${key}?ttl=300&name=${encodeURIComponent('Sổ hồng.pdf')}`,
        createdBy: userIds['agent1'],
        createdAt: undefined,
      },
    );
    const second = await addDocument(property.id, {
      documentType: 'SURVEY_MAP',
      fileName: 'ban-ve.jpg',
      mimeType: 'image/jpeg',
    });
    assert.ok(second.url.includes('/documents/') && second.url.includes('.jpg'));
    assert.deepEqual(
      (await documentList(property.id, 'manager')).map((document) => document.id),
      [second.id, first.id],
    );
  });

  it('người không có quyền xem giấy tờ → 403; xem được BĐS khác phạm vi → 403', async () => {
    const property = await createProperty();
    await addDocument(property.id);
    for (const user of ['agent2', 'agent4']) {
      assert.equal(
        (await errorOf(await documents(property.id, user), 403)).code,
        'FORBIDDEN',
        user,
      );
    }
    const own = await createProperty('noDocs');
    assert.equal((await errorOf(await documents(own.id, 'noDocs'), 403)).code, 'FORBIDDEN');
    assert.equal(
      (await errorOf(await requestUpload(own.id, PDF, 'noDocs'), 403)).code,
      'FORBIDDEN',
    );
    assert.equal((await documentList(property.id, 'leader')).length, 1);
  });

  it('CCCD chủ nhà: cần thêm quyền xem liên hệ chủ nhà để thêm, thấy và xoá', async () => {
    const property = await createProperty('noContact');
    const land = await addDocument(property.id, {}, 'noContact');
    const idCard = {
      documentType: 'OWNER_ID_DOCUMENT',
      fileName: 'cccd.jpg',
      mimeType: 'image/jpeg',
    };
    assert.equal(
      (
        await errorOf(
          await requestUpload(property.id, { ...idCard, sizeBytes: 10 }, 'noContact'),
          403,
        )
      ).code,
      'FORBIDDEN',
    );
    const card = await addDocument(property.id, idCard, 'admin');
    assert.deepEqual(
      (await documentList(property.id, 'noContact')).map((document) => document.id),
      [land.id],
      'không thấy CCCD',
    );
    assert.equal((await remove(property.id, card.id, 'noContact')).status, 404);
    assert.deepEqual(
      (await documentList(property.id, 'admin')).map((document) => document.id),
      [card.id, land.id],
    );
    assert.equal((await remove(property.id, card.id, 'admin')).status, 204);
  });

  it('thêm, xoá cần quyền sửa BĐS: agent cùng nhóm → 403; trưởng nhóm, trưởng phòng được', async () => {
    const property = await createProperty();
    const document = await addDocument(property.id);
    assert.equal(
      (await errorOf(await requestUpload(property.id, PDF, 'agent2'), 403)).code,
      'FORBIDDEN',
    );
    assert.equal(
      (await errorOf(await remove(property.id, document.id, 'agent2'), 403)).code,
      'FORBIDDEN',
    );
    await addDocument(property.id, {}, 'leader');
    assert.equal((await remove(property.id, document.id, 'manager')).status, 204);
    assert.equal((await remove(property.id, document.id, 'manager')).status, 404, 'đã xoá');
    const [row] = (await db.query('SELECT deleted_at FROM property_documents WHERE id = $1', [
      document.id,
    ])) as { deleted_at: Date | null }[];
    assert.ok(row?.deleted_at);
    assert.equal((await documentList(property.id)).length, 1);
  });

  it('xác nhận khi chưa upload, sai định dạng, quá 10MB → 422; xác nhận lại → 409', async () => {
    const property = await createProperty();
    const upload = ((await (await requestUpload(property.id, PDF)).json()) as { data: Upload })
      .data;
    const key = String(uploadKeys.at(-1));
    const payload = confirmPayload(PDF, upload.documentId);
    assert.equal(
      (await errorOf(await confirm(property.id, payload), 422)).code,
      'BUSINESS_RULE_VIOLATION',
    );
    stored.set(key, { sizeBytes: 100, contentType: 'image/png' });
    assert.equal(
      (await errorOf(await confirm(property.id, payload), 422)).code,
      'BUSINESS_RULE_VIOLATION',
    );
    stored.set(key, { sizeBytes: 10 * MB + 1, contentType: 'application/pdf' });
    assert.equal(
      (await errorOf(await confirm(property.id, payload), 422)).code,
      'BUSINESS_RULE_VIOLATION',
    );
    stored.set(key, { sizeBytes: 100, contentType: 'application/pdf' });
    assert.equal((await confirm(property.id, payload)).status, 201);
    assert.equal((await errorOf(await confirm(property.id, payload), 409)).code, 'CONFLICT');
  });

  it('dữ liệu sai → 400: loại, định dạng, tên file có đường dẫn, quá 10MB, trường lạ', async () => {
    const property = await createProperty();
    assert.deepEqual(await fieldsOf(await requestUpload(property.id, {})), [
      'documentType',
      'fileName',
      'mimeType',
      'sizeBytes',
    ]);
    const invalid: [Record<string, unknown>, string][] = [
      [{ documentType: 'PASSPORT' }, 'documentType'],
      [{ mimeType: 'application/msword' }, 'mimeType'],
      [{ fileName: '   ' }, 'fileName'],
      [{ fileName: '../../etc/passwd' }, 'fileName'],
      [{ fileName: 'a\\b.pdf' }, 'fileName'],
      [{ fileName: 'a\nb.pdf' }, 'fileName'],
      [{ fileName: '<b>x</b>.pdf' }, 'fileName'],
      [{ fileName: 'x'.repeat(256) }, 'fileName'],
      [{ sizeBytes: 10 * MB + 1 }, 'sizeBytes'],
      [{ storageKey: 'x' }, 'storageKey'],
    ];
    for (const [override, field] of invalid) {
      assert.deepEqual(
        await fieldsOf(await requestUpload(property.id, { ...PDF, ...override })),
        [field],
        JSON.stringify(override),
      );
    }
  });

  it('tối đa 30 giấy tờ mỗi BĐS → 422', async () => {
    const property = await createProperty();
    await db.query(
      `INSERT INTO property_documents
         (tenant_id, property_id, document_type, file_name, storage_key, mime_type, size_bytes)
       SELECT $1::uuid, $2::uuid, 'OTHER', 'f.pdf',
              $1::text || '/properties/' || $2::text || '/documents/seed-' || n || '.pdf',
              'application/pdf', 1
         FROM generate_series(1, 30) AS n`,
      [tenantA, property.id],
    );
    assert.equal(
      (await errorOf(await requestUpload(property.id, PDF), 422)).code,
      'BUSINESS_RULE_VIOLATION',
    );
  });

  it('BĐS không xem được, công ty khác, không tồn tại → 404; id sai → 400; chưa đăng nhập → 401', async () => {
    const property = await createProperty();
    await db.query(`UPDATE properties SET status = 'HIDDEN' WHERE id = $1`, [property.id]);
    assert.equal((await documents(property.id, 'agent2')).status, 404);
    assert.equal((await documents(property.id, 'agent1')).status, 200);
    const other = await createProperty('_', await login('admin@b.vn'));
    assert.equal((await documents(other.id, 'admin')).status, 404);
    assert.equal((await requestUpload(other.id, PDF, 'admin')).status, 404);
    assert.equal((await documents('00000000-0000-4000-8000-000000000000')).status, 404);
    assert.equal((await documents('abc')).status, 400);
    assert.equal((await request('GET', `/properties/${property.id}/documents`)).status, 401);
  });
});
