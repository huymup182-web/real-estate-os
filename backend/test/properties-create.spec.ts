import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

interface ApiError {
  error: { code: string; details?: { field?: string; message: string }[] };
}

interface Session {
  accessToken: string;
  userId: string;
  tenantId: string;
}

interface PropertyData {
  id: string;
  code: string;
  [key: string]: unknown;
}

describe('POST /api/v1/properties', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let companyA: Session;
  let companyB: Session;
  let noRole: Session;
  let khanhHoa: string;
  let nhaTrang: string;
  let vinhHai: string;
  let hcm: string;
  let benNghe: string;
  let closedWard: string;

  before(async () => {
    await useTestDatabase();
    app = await createApp();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    db = app.get(DataSource);

    khanhHoa = await insertId(`INSERT INTO provinces (code, name) VALUES ('56', 'Khánh Hòa')`);
    hcm = await insertId(`INSERT INTO provinces (code, name) VALUES ('79', 'TP. Hồ Chí Minh')`);
    nhaTrang = await insertId(
      `INSERT INTO districts (province_id, code, name) VALUES ($1, '568', 'Nha Trang')`,
      [khanhHoa],
    );
    vinhHai = await insertId(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, '22330', 'Vĩnh Hải')`,
      [khanhHoa],
    );
    closedWard = await insertId(
      `INSERT INTO wards (province_id, code, name, is_active) VALUES ($1, '22331', 'Đã nhập', false)`,
      [khanhHoa],
    );
    benNghe = await insertId(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, '26740', 'Bến Nghé')`,
      [hcm],
    );

    companyA = await registerAndLogin('a@test.vn');
    companyB = await registerAndLogin('b@test.vn');
    noRole = await registerAndLogin('norole@test.vn', async (userId) => {
      await db.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    });
  });

  after(async () => {
    await app.close();
  });

  async function insertId(sql: string, params: unknown[] = []): Promise<string> {
    const [row] = (await db.query(`${sql} RETURNING id`, params)) as { id: string }[];
    assert.ok(row);
    return row.id;
  }

  async function registerAndLogin(
    email: string,
    beforeLogin?: (userId: string) => Promise<void>,
  ): Promise<Session> {
    const registered = await request('POST', '/auth/register', {
      companyName: `Công ty ${email}`,
      fullName: 'Môi giới',
      email,
      password: PASSWORD,
    });
    assert.equal(registered.status, 201);
    const data = (
      (await registered.json()) as { data: { user: { id: string }; company: { id: string } } }
    ).data;
    await beforeLogin?.(data.user.id);
    const login = await request('POST', '/auth/login', { identifier: email, password: PASSWORD });
    assert.equal(login.status, 200);
    const tokens = ((await login.json()) as { data: { accessToken: string } }).data;
    return { accessToken: tokens.accessToken, userId: data.user.id, tenantId: data.company.id };
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

  function minimal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      title: 'Nhà phố Vĩnh Hải',
      propertyType: 'HOUSE',
      price: 3_500_000_000,
      area: 70,
      provinceId: khanhHoa,
      wardId: vinhHai,
      ...overrides,
    };
  }

  function create(payload: unknown, session: Session = companyA): Promise<Response> {
    return request('POST', '/properties', payload, session.accessToken);
  }

  async function created(payload: unknown, session: Session = companyA): Promise<PropertyData> {
    const response = await create(payload, session);
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
    return ((await response.json()) as { data: PropertyData }).data;
  }

  async function invalidFields(payload: unknown): Promise<string[]> {
    const response = await create(payload);
    assert.equal(response.status, 400);
    const body = (await response.json()) as ApiError;
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    return [...new Set((body.error.details ?? []).map((detail) => detail.field ?? ''))].sort();
  }

  it('tạo đủ trường → 201; người tạo là môi giới phụ trách, AVAILABLE, chưa xác minh', async () => {
    const data = await created({
      title: '  Nhà phố 3 tầng Vĩnh Hải  ',
      description: 'Gần biển, hẻm ô tô.',
      propertyType: 'HOUSE',
      price: 4_200_000_000,
      area: 84.5,
      bedrooms: 4,
      bathrooms: 3,
      floors: 3,
      direction: 'SE',
      roadWidth: 6.5,
      roadAccess: 'CAR',
      legalStatus: 'PRIVATE_BOOK',
      provinceId: khanhHoa,
      districtId: nhaTrang,
      wardId: vinhHai,
      streetAddress: '12 Đường 2/4',
      latitude: 12.276543,
      longitude: 109.198765,
      source: 'OWNER_DIRECT',
      commissionType: 'PERCENT',
      commissionValue: 1.5,
    });
    assert.match(data.code, /^BDS-\d{6}$/);
    assert.deepEqual(
      {
        title: data['title'],
        transactionType: data['transactionType'],
        price: data['price'],
        area: data['area'],
        pricePerM2: data['pricePerM2'],
        roadWidth: data['roadWidth'],
        latitude: data['latitude'],
        longitude: data['longitude'],
        commissionValue: data['commissionValue'],
        status: data['status'],
        verificationStatus: data['verificationStatus'],
        agentId: data['agentId'],
        createdBy: data['createdBy'],
        ownerId: data['ownerId'],
      },
      {
        title: 'Nhà phố 3 tầng Vĩnh Hải',
        transactionType: 'SALE',
        price: 4_200_000_000,
        area: 84.5,
        pricePerM2: Math.round(4_200_000_000 / 84.5),
        roadWidth: 6.5,
        latitude: 12.276543,
        longitude: 109.198765,
        commissionValue: 1.5,
        status: 'AVAILABLE',
        verificationStatus: 'UNVERIFIED',
        agentId: companyA.userId,
        createdBy: companyA.userId,
        ownerId: null,
      },
    );
    assert.equal('tenantId' in data, false);

    const [row] = (await db.query(
      'SELECT tenant_id, location IS NOT NULL AS located FROM properties WHERE id = $1',
      [data.id],
    )) as { tenant_id: string; located: boolean }[];
    assert.equal(row?.tenant_id, companyA.tenantId);
    assert.equal(row?.located, true);
  });

  it('chỉ gửi trường bắt buộc → 201, trường tuỳ chọn là null', async () => {
    const data = await created(minimal());
    for (const field of [
      'description',
      'bedrooms',
      'direction',
      'districtId',
      'streetAddress',
      'latitude',
      'commissionType',
    ]) {
      assert.equal(data[field], null, field);
    }
  });

  it('mã BĐS tăng dần và đếm riêng theo từng công ty', async () => {
    const first = await created(minimal(), companyB);
    const second = await created(minimal(), companyB);
    assert.equal(first.code, 'BDS-000001');
    assert.equal(second.code, 'BDS-000002');
    const ofA = await created(minimal());
    assert.notEqual(Number(ofA.code.slice(4)), 1);
  });

  it('tạo đồng thời không bị trùng mã', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => created(minimal())));
    assert.equal(new Set(results.map((property) => property.code)).size, 10);
  });

  it('thiếu trường bắt buộc → 400 chỉ rõ từng trường', async () => {
    assert.deepEqual(await invalidFields({}), [
      'area',
      'price',
      'propertyType',
      'provinceId',
      'title',
      'wardId',
    ]);
  });

  it('không nhận tenantId, mã, trạng thái, môi giới, chủ nhà, loại giao dịch từ client', async () => {
    for (const field of ['tenantId', 'code', 'status', 'agentId', 'ownerId', 'transactionType']) {
      assert.deepEqual(await invalidFields(minimal({ [field]: 'x' })), [field], field);
    }
  });

  it('giá trị sai kiểu/ngoài danh sách/ngoài giới hạn → 400', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ title: '   ' }, 'title'],
      [{ title: '<b>Nhà</b>' }, 'title'],
      [{ title: 'x'.repeat(256) }, 'title'],
      [{ propertyType: 'CASTLE' }, 'propertyType'],
      [{ price: -1 }, 'price'],
      [{ price: 1.5 }, 'price'],
      [{ price: '3000000000' }, 'price'],
      [{ area: 0 }, 'area'],
      [{ area: 10.123 }, 'area'],
      [{ bedrooms: -1 }, 'bedrooms'],
      [{ direction: 'UP' }, 'direction'],
      [{ roadAccess: 'BOAT' }, 'roadAccess'],
      [{ legalStatus: 'NONE' }, 'legalStatus'],
      [{ source: 'X' }, 'source'],
      [{ provinceId: 'abc' }, 'provinceId'],
      [{ description: '<script>alert(1)</script>' }, 'description'],
      [{ latitude: 12.3 }, 'longitude'],
      [{ latitude: 91, longitude: 100 }, 'latitude'],
      [{ commissionType: 'FIXED' }, 'commissionValue'],
      [{ commissionValue: 10 }, 'commissionType'],
      [{ commissionType: 'PERCENT', commissionValue: 101 }, 'commissionValue'],
    ];
    for (const [overrides, field] of cases) {
      assert.deepEqual(await invalidFields(minimal(overrides)), [field], JSON.stringify(overrides));
    }
  });

  it('địa giới không tồn tại, không thuộc tỉnh hoặc đã ngừng dùng → 400', async () => {
    assert.deepEqual(
      await invalidFields(minimal({ provinceId: '00000000-0000-4000-8000-000000000000' })),
      ['provinceId'],
    );
    assert.deepEqual(await invalidFields(minimal({ wardId: benNghe })), ['wardId']);
    assert.deepEqual(await invalidFields(minimal({ wardId: closedWard })), ['wardId']);
    assert.deepEqual(
      await invalidFields(minimal({ provinceId: hcm, wardId: benNghe, districtId: nhaTrang })),
      ['districtId'],
    );
  });

  it('chưa đăng nhập → 401; không có quyền property.create → 403, không tạo gì', async () => {
    assert.equal((await request('POST', '/properties', minimal())).status, 401);

    const response = await create(minimal(), noRole);
    assert.equal(response.status, 403);
    assert.equal(((await response.json()) as ApiError).error.code, 'FORBIDDEN');
    const [row] = (await db.query(
      'SELECT count(*)::int AS n FROM properties WHERE tenant_id = $1',
      [noRole.tenantId],
    )) as { n: number }[];
    assert.equal(row?.n, 0);
  });
});
