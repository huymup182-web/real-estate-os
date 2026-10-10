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
const MISSING = '00000000-0000-4000-8000-000000000000';
const OWNER_PHONE = '+84912345678';

interface Match {
  code: string;
  similarity: number;
  reasons: string[];
  property: { id: string; title: string; price: number; area: number; status: string } | null;
}

interface Report {
  threshold: number;
  matches: Match[];
}

/**
 * Công ty A: admin, agent1, agent2 (AGENT xem mọi BĐS công ty), `viewer` (chỉ `property.view`). Phường Vĩnh
 * Hải: `house` (agent1, có toạ độ, chủ nhà), `copy` (agent2, cùng chủ nhà, giá lệch 2%, đã ẩn), `apartment`
 * (khác loại BĐS), `other` (khác hẳn). Phường Lộc Thọ: `nearby` cách `house` ~100 m. Công ty B có BĐS giống hệt.
 */
describe('BĐS nghi trùng (TASK-144)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let khanhHoa: string;
  let vinhHai: string;
  let house: string;
  let copy: string;
  let other: string;
  const codes: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const houseData = () => ({
    title: 'Bán nhà phố Vĩnh Hải',
    description: 'Nhà mới xây 3 tầng, gần biển, hẻm ô tô, sổ hồng riêng.',
    streetAddress: '12 Trần Phú',
    propertyType: 'HOUSE',
    price: 5_000_000_000,
    area: 80,
    provinceId: khanhHoa,
    wardId: vinhHai,
    latitude: 12.2851,
    longitude: 109.2015,
  });

  before(async () => {
    await useTestDatabase();
    app = await createApp();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
    db = app.get(DataSource);

    khanhHoa = await insertId(`INSERT INTO provinces (code, name) VALUES ('56', 'Khánh Hòa')`);
    vinhHai = await insertId(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, '22330', 'Vĩnh Hải')`,
      [khanhHoa],
    );
    const locTho = await insertId(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, '22366', 'Lộc Thọ')`,
      [khanhHoa],
    );
    const tenantA = await register('admin@a.vn');
    tokens['admin'] = await login('admin@a.vn');
    const hash = await hashPassword(PASSWORD);
    const viewerRole = await insertId(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'PROPERTY_VIEWER', 'Xem BĐS')`,
      [tenantA],
    );
    await db.query(
      `INSERT INTO role_permissions (role_id, permission_id, scope)
       SELECT $1, id, 'COMPANY' FROM permissions WHERE code = 'property.view'`,
      [viewerRole],
    );
    for (const [name, role] of [
      ['agent1', 'AGENT'],
      ['agent2', 'AGENT'],
      ['viewer', 'PROPERTY_VIEWER'],
    ] as const) {
      const id = await insertId(
        `INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, $4)`,
        [tenantA, `${name}@a.vn`, hash, name],
      );
      await db.query(
        `INSERT INTO user_roles (user_id, role_id, tenant_id)
         SELECT $1, id, tenant_id FROM roles WHERE tenant_id = $2 AND code = $3`,
        [id, tenantA, role],
      );
      tokens[name] = await login(`${name}@a.vn`);
    }
    await register('admin@b.vn');
    tokens['otherAdmin'] = await login('admin@b.vn');

    house = await create('agent1', 'house', houseData());
    await send('agent1', 'PUT', `/properties/${house}/owner`, {
      fullName: 'Bác Hai',
      phone: OWNER_PHONE,
    });
    copy = await create('agent2', 'copy', {
      ...houseData(),
      title: 'Nhà Vĩnh Hải chính chủ',
      description: 'Nhà mới xây 3 tầng gần biển, hẻm ô tô, sổ hồng riêng',
      streetAddress: 'Số 12 đường Trần Phú',
      price: 4_900_000_000,
      latitude: 12.28512,
      longitude: 109.20152,
    });
    await send('agent2', 'PUT', `/properties/${copy}/owner`, {
      fullName: 'Chú Hai',
      phone: OWNER_PHONE,
    });
    await send('agent2', 'POST', `/properties/${copy}/status`, { status: 'HIDDEN' });
    await create('agent1', 'apartment', { ...houseData(), propertyType: 'APARTMENT' });
    other = await create('agent1', 'other', {
      ...houseData(),
      title: 'Nhà hẻm nhỏ',
      description: 'Nhà cấp 4 cần sửa',
      streetAddress: '200 Hai Bà Trưng',
      price: 2_000_000_000,
      area: 45,
      latitude: undefined,
      longitude: undefined,
    });
    // Cách `house` khoảng 22 m về phía bắc nhưng ghi khác phường.
    await create('agent1', 'nearby', { ...houseData(), wardId: locTho, latitude: 12.2853 });
    await create('otherAdmin', 'otherCompany', { ...houseData(), provinceId: khanhHoa });
  });

  after(async () => {
    await app.close();
  });

  async function insertId(sql: string, params: unknown[] = []): Promise<string> {
    const [row] = (await db.query(`${sql} RETURNING id`, params)) as { id: string }[];
    assert.ok(row);
    return row.id;
  }

  async function register(email: string): Promise<string> {
    const response = await request('POST', '/auth/register', {
      companyName: `Công ty ${email}`,
      fullName: 'Quản trị',
      email,
      password: PASSWORD,
    });
    assert.equal(response.status, 201);
    return ((await response.json()) as { data: { company: { id: string } } }).data.company.id;
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

  async function send(user: string, method: string, path: string, payload: unknown) {
    const response = await request(method, path, payload, tokens[user]);
    assert.ok(response.status < 300, await response.clone().text());
  }

  async function create(user: string, name: string, payload: unknown): Promise<string> {
    const response = await request('POST', '/properties', payload, tokens[user]);
    assert.equal(response.status, 201, await response.clone().text());
    const { data } = (await response.json()) as { data: { id: string; code: string } };
    codes[name] = data.code;
    return data.id;
  }

  async function report(response: Response): Promise<Report> {
    assert.equal(response.status, 200, await response.clone().text());
    return ((await response.json()) as { data: Report }).data;
  }

  it('BĐS sắp đăng giống BĐS có sẵn: báo nghi trùng, độ giống cao trước, kèm lý do', async () => {
    const result = await report(
      await request('POST', '/properties/duplicate-check', houseData(), tokens['agent1']),
    );
    assert.equal(result.threshold, 70);
    assert.deepEqual(
      result.matches.map((match) => match.code).sort(),
      [codes['house'], codes['copy'], codes['nearby']].sort(),
    );
    const find = (name: string) => result.matches.find((match) => match.code === codes[name]);
    const [first] = result.matches;
    const second = find('copy');
    const third = find('nearby');
    assert.equal(first?.similarity, 100);
    assert.deepEqual(first?.reasons, [
      'Cùng phường/xã',
      'Cách 0 m',
      'Cùng giá',
      'Cùng diện tích',
      'Địa chỉ giống 100%',
      'Mô tả giống 100%',
    ]);
    assert.deepEqual(first?.property, {
      id: house,
      title: 'Bán nhà phố Vĩnh Hải',
      price: 5_000_000_000,
      area: 80,
      status: 'AVAILABLE',
    });
    assert.ok((second?.similarity ?? 0) >= 80, JSON.stringify(second));
    assert.ok(second?.reasons.includes('Giá lệch 2%'));
    // BĐS đã ẩn của agent2: agent1 không xem được nên chỉ có mã.
    assert.equal(second?.property, null);
    // Khác phường nhưng cách ~22 m.
    assert.ok(third?.reasons.includes('Cách 22 m'), JSON.stringify(third));
    assert.ok(!third?.reasons.includes('Cùng phường/xã'));

    // Admin xem được BĐS đã ẩn.
    const admin = await report(
      await request('POST', '/properties/duplicate-check', houseData(), tokens['admin']),
    );
    const hidden = admin.matches.find((match) => match.code === codes['copy']);
    assert.equal(hidden?.property?.status, 'HIDDEN');
  });

  it('BĐS có sẵn: so cả SĐT chủ nhà, không tự so với chính nó, không lộ SĐT', async () => {
    const response = await request(
      'GET',
      `/properties/${house}/duplicates`,
      undefined,
      tokens['viewer'],
    );
    const text = await response.clone().text();
    const result = await report(response);
    assert.deepEqual(result.matches[0]?.code, codes['copy']);
    assert.ok(result.matches[0]?.reasons.includes('Cùng số điện thoại chủ nhà'));
    assert.ok(!result.matches.some((match) => match.code === codes['house']));
    assert.ok(!text.includes('912345678'));
  });

  it('khác hẳn thì không có BĐS nghi trùng; không so khác loại BĐS, khác công ty', async () => {
    const result = await report(
      await request('GET', `/properties/${other}/duplicates`, undefined, tokens['agent1']),
    );
    assert.deepEqual(result.matches, []);
    const checked = await report(
      await request('POST', '/properties/duplicate-check', houseData(), tokens['agent1']),
    );
    assert.ok(!checked.matches.some((match) => match.code === codes['apartment']));
    // Mã BĐS đánh riêng từng công ty nên so số lượng: chỉ 3 BĐS của công ty A.
    assert.equal(checked.matches.length, 3);
  });

  it('chỉ cảnh báo: kiểm trùng không tạo BĐS, vẫn tạo được BĐS giống hệt', async () => {
    const [before] = (await db.query(`SELECT count(*)::int AS n FROM properties`)) as {
      n: number;
    }[];
    await report(
      await request('POST', '/properties/duplicate-check', houseData(), tokens['agent1']),
    );
    const [afterCheck] = (await db.query(`SELECT count(*)::int AS n FROM properties`)) as {
      n: number;
    }[];
    assert.equal(afterCheck?.n, before?.n);
    assert.equal((await request('POST', '/properties', houseData(), tokens['agent1'])).status, 201);
  });

  it('quyền, phạm vi, kiểm dữ liệu', async () => {
    const check = (user: string | undefined, payload: unknown) =>
      request('POST', '/properties/duplicate-check', payload, user && tokens[user]);
    assert.equal((await check('viewer', houseData())).status, 403);
    assert.equal((await check(undefined, houseData())).status, 401);
    assert.equal((await check('agent1', { ...houseData(), price: -1 })).status, 400);
    const get = (user: string, id: string) =>
      request('GET', `/properties/${id}/duplicates`, undefined, tokens[user]);
    assert.equal((await get('otherAdmin', house)).status, 404);
    assert.equal((await get('agent1', MISSING)).status, 404);
    assert.equal((await get('agent1', 'khong-phai-uuid')).status, 400);
    // BĐS đã ẩn của agent2: agent1 không xem được.
    assert.equal((await get('agent1', copy)).status, 404);
  });
});
