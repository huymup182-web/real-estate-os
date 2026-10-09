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
 * phòng D2 có agent4. Mỗi test dùng một từ riêng (`tag()`) để không lẫn với BĐS của test khác.
 */
describe('Tìm và lọc BĐS GET /api/v1/properties (q, giá, diện tích, khu vực, loại, số phòng, pháp lý, hướng, độ rộng đường, sắp xếp, phân trang)', () => {
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
  /** Từ riêng cho mỗi test, chỉ gồm chữ để tách từ đúng một token. */
  function tag(): string {
    tagSeq += 1;
    return `zq${'abcdefghij'[tagSeq % 10]}${'klmnopqrst'[Math.floor(tagSeq / 10) % 10]}x`;
  }

  async function createProperty(
    values: Record<string, unknown>,
    user = 'agent1',
    token = tokens[user],
  ): Promise<Detail & { code: string }> {
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
      token,
    );
    assert.equal(response.status, 201, await response.clone().text());
    return ((await response.json()) as { data: Detail & { code: string } }).data;
  }

  async function search(
    q: string,
    user = 'agent1',
    extra = '',
  ): Promise<{ ids: string[]; total: number }> {
    const response = await request(
      'GET',
      `/properties?pageSize=100&q=${encodeURIComponent(q)}${extra}`,
      undefined,
      tokens[user],
    );
    assert.equal(response.status, 200, await response.clone().text());
    const body = (await response.json()) as { data: { id: string }[]; meta: { total: number } };
    return { ids: body.data.map((item) => item.id), total: body.meta.total };
  }

  it('tìm trong tiêu đề, mô tả: gõ có dấu, không dấu, hoa thường, gõ dở từ cuối đều ra; mọi từ phải có', async () => {
    const word = tag();
    const house = await createProperty({
      title: `Nhà phố Vĩnh Hải ${word}`,
      description: 'Gần biển, đường ô tô',
    });
    const other = await createProperty({ title: `Đất nền Phước Đồng ${word}` });
    for (const q of [
      `vinh hai ${word}`,
      `Vĩnh Hải ${word}`,
      `VINH ${word.toUpperCase()}`,
      `${word} vinh ha`,
      `${word} gan bien`,
      `${word}, đường ô-tô!`,
    ]) {
      assert.deepEqual((await search(q)).ids, [house.id], q);
    }
    const both = await search(word);
    assert.deepEqual(both.ids, [other.id, house.id], 'mới tạo trước');
    assert.equal(both.total, 2);
    assert.deepEqual((await search(`${word} phuoc dong`)).ids, [other.id]);
    assert.deepEqual((await search(`${word} khongcotu`)).ids, []);
    const page = await request(
      'GET',
      `/properties?q=${word}&page=2&pageSize=1`,
      undefined,
      tokens['agent1'],
    );
    const body = (await page.json()) as { data: { id: string }[]; meta: { total: number } };
    assert.deepEqual(
      body.data.map((item) => item.id),
      [house.id],
    );
    assert.equal(body.meta.total, 2);
  });

  it('tìm đúng mã BĐS, không phân biệt hoa thường', async () => {
    const property = await createProperty({ title: `Căn hộ ${tag()}` });
    assert.deepEqual((await search(property.code)).ids, [property.id]);
    assert.deepEqual((await search(property.code.toLowerCase())).ids, [property.id]);
    assert.deepEqual((await search('!!!')).ids, []);
  });

  it('địa chỉ chi tiết chỉ tìm được với BĐS mình được xem liên hệ chủ nhà', async () => {
    const word = tag();
    const property = await createProperty({
      title: 'Nhà hẻm',
      streetAddress: `Hẻm ${word} Trần Phú`,
    });
    assert.deepEqual((await search(word, 'agent1')).ids, [property.id]);
    assert.deepEqual((await search(word, 'manager')).ids, [property.id]);
    assert.deepEqual((await search(word, 'agent2')).ids, [], 'không có quyền xem địa chỉ');
    assert.deepEqual((await search(word, 'agent4')).ids, []);
    const titled = await createProperty({ title: `Nhà ${word}`, streetAddress: 'Hẻm khác' });
    assert.deepEqual((await search(word, 'agent2')).ids, [titled.id]);
  });

  it('vẫn theo phạm vi xem: BĐS ẩn, đã xoá, công ty khác không ra', async () => {
    const word = tag();
    const visible = await createProperty({ title: `Nhà ${word}` });
    const hidden = await createProperty({ title: `Nhà ${word}` });
    await db.query(`UPDATE properties SET status = 'HIDDEN' WHERE id = $1`, [hidden.id]);
    const removed = await createProperty({ title: `Nhà ${word}` });
    assert.equal(
      (await request('DELETE', `/properties/${removed.id}`, undefined, tokens['admin'])).status,
      204,
    );
    await createProperty({ title: `Nhà ${word}` }, '_', tokens['adminB']);
    assert.deepEqual((await search(word, 'agent2')).ids, [visible.id]);
    assert.deepEqual((await search(word, 'agent1')).ids, [hidden.id, visible.id]);
  });

  it('q rỗng hoặc chỉ khoảng trắng thì không lọc; q quá 200 ký tự hoặc lặp tham số → 400', async () => {
    const all = await request('GET', '/properties?pageSize=1', undefined, tokens['agent1']);
    const total = ((await all.json()) as { meta: { total: number } }).meta.total;
    assert.equal((await search('')).total, total);
    assert.equal((await search('   ')).total, total);
    const long = await request(
      'GET',
      `/properties?q=${'a'.repeat(201)}`,
      undefined,
      tokens['agent1'],
    );
    assert.equal(long.status, 400);
    const twice = await request('GET', '/properties?q=a&q=b', undefined, tokens['agent1']);
    assert.equal(twice.status, 400);
  });

  it('lọc giá: priceMin, priceMax gồm cả hai đầu, dùng riêng hoặc kèm từ khoá', async () => {
    const word = tag();
    const cheap = await createProperty({ title: `Nhà ${word}`, price: 1_000_000_000 });
    const middle = await createProperty({ title: `Nhà ${word}`, price: 3_000_000_000 });
    const expensive = await createProperty({ title: `Nhà ${word}`, price: 9_000_000_000 });
    assert.deepEqual((await search(word, 'agent1', '&priceMin=3000000000')).ids, [
      expensive.id,
      middle.id,
    ]);
    assert.deepEqual((await search(word, 'agent1', '&priceMax=3000000000')).ids, [
      middle.id,
      cheap.id,
    ]);
    assert.deepEqual(
      (await search(word, 'agent1', '&priceMin=1000000000&priceMax=3000000000')).ids,
      [middle.id, cheap.id],
    );
    assert.deepEqual(
      (await search(word, 'agent1', '&priceMin=3000000000&priceMax=3000000000')).ids,
      [middle.id],
    );
    assert.deepEqual((await search(word, 'agent1', '&priceMin=9000000001')).ids, []);
    const all = await request(
      'GET',
      '/properties?pageSize=100&priceMin=8999999999&priceMax=9000000000',
      undefined,
      tokens['agent1'],
    );
    const body = (await all.json()) as { data: { id: string; price: number }[] };
    assert.ok(body.data.some((item) => item.id === expensive.id));
    assert.ok(body.data.every((item) => item.price === 9_000_000_000));
  });

  it('giá sai: âm, không phải số nguyên, priceMin > priceMax → 400', async () => {
    for (const query of [
      'priceMin=-1',
      'priceMax=abc',
      'priceMin=1.5',
      'priceMin=99999999999999999999',
      'priceMin=5&priceMax=4',
    ]) {
      const response = await request('GET', `/properties?${query}`, undefined, tokens['agent1']);
      assert.equal(response.status, 400, query);
      const error = ((await response.json()) as { error: { details: { field: string }[] } }).error;
      assert.ok(
        error.details.some((detail) => detail.field.startsWith('price')),
        `${query}: ${JSON.stringify(error)}`,
      );
    }
  });

  it('lọc diện tích: areaMin, areaMax (m², số lẻ) gồm cả hai đầu, kèm lọc giá và từ khoá', async () => {
    const word = tag();
    const small = await createProperty({ title: `Nhà ${word}`, area: 45.5 });
    const medium = await createProperty({ title: `Nhà ${word}`, area: 80 });
    const large = await createProperty({
      title: `Nhà ${word}`,
      area: 250.75,
      price: 9_000_000_000,
    });
    assert.deepEqual((await search(word, 'agent1', '&areaMin=80')).ids, [large.id, medium.id]);
    assert.deepEqual((await search(word, 'agent1', '&areaMax=45.5')).ids, [small.id]);
    assert.deepEqual((await search(word, 'agent1', '&areaMin=45.51&areaMax=250.75')).ids, [
      large.id,
      medium.id,
    ]);
    assert.deepEqual((await search(word, 'agent1', '&areaMin=80&priceMax=5000000000')).ids, [
      medium.id,
    ]);
    assert.deepEqual((await search(word, 'agent1', '&areaMin=250.76')).ids, []);
  });

  it('diện tích sai: âm, không phải số, quá 2 chữ số thập phân, areaMin > areaMax → 400', async () => {
    for (const query of [
      'areaMin=-1',
      'areaMax=abc',
      'areaMin=1.234',
      'areaMax=Infinity',
      'areaMin=99999999999',
      'areaMin=100&areaMax=99.99',
    ]) {
      const response = await request('GET', `/properties?${query}`, undefined, tokens['agent1']);
      assert.equal(response.status, 400, query);
      const error = ((await response.json()) as { error: { details: { field: string }[] } }).error;
      assert.ok(
        error.details.some((detail) => detail.field.startsWith('area')),
        `${query}: ${JSON.stringify(error)}`,
      );
    }
  });

  it('lọc khu vực: tỉnh, quận cũ, phường; kết hợp được với bộ lọc khác', async () => {
    const word = tag();
    const lamDong = await insertId(`INSERT INTO provinces (code, name) VALUES ('68', 'Lâm Đồng')`);
    const daLat = await insertId(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, '24781', 'Xuân Hương - Đà Lạt')`,
      [lamDong],
    );
    const phuocDong = await insertId(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, '22420', 'Phước Đồng')`,
      [khanhHoa],
    );
    const inVinhHai = await createProperty({ title: `Nhà ${word}`, price: 5_000_000_000 });
    const inPhuocDong = await createProperty({
      title: `Nhà ${word}`,
      districtId: undefined,
      wardId: phuocDong,
    });
    const inDaLat = await createProperty({
      title: `Nhà ${word}`,
      provinceId: lamDong,
      districtId: undefined,
      wardId: daLat,
    });
    assert.deepEqual((await search(word, 'agent1', `&provinceId=${khanhHoa}`)).ids, [
      inPhuocDong.id,
      inVinhHai.id,
    ]);
    assert.deepEqual((await search(word, 'agent1', `&provinceId=${lamDong}`)).ids, [inDaLat.id]);
    assert.deepEqual((await search(word, 'agent1', `&districtId=${nhaTrang}`)).ids, [inVinhHai.id]);
    assert.deepEqual((await search(word, 'agent1', `&wardId=${phuocDong}`)).ids, [inPhuocDong.id]);
    assert.deepEqual(
      (await search(word, 'agent1', `&provinceId=${lamDong}&wardId=${phuocDong}`)).ids,
      [],
      'phường không thuộc tỉnh thì không ra gì',
    );
    assert.deepEqual(
      (await search(word, 'agent1', `&provinceId=${khanhHoa}&priceMin=4000000000`)).ids,
      [inVinhHai.id],
    );
  });

  it('id khu vực sai dạng → 400', async () => {
    for (const field of ['provinceId', 'districtId', 'wardId']) {
      const response = await request(
        'GET',
        `/properties?${field}=abc`,
        undefined,
        tokens['agent1'],
      );
      assert.equal(response.status, 400, field);
      const error = ((await response.json()) as { error: { details: { field: string }[] } }).error;
      assert.ok(
        error.details.some((detail) => detail.field === field),
        JSON.stringify(error),
      );
    }
  });

  it('lọc loại BĐS: một loại, nhiều loại (dấu phẩy hoặc lặp tham số), kết hợp bộ lọc khác', async () => {
    const word = tag();
    const house = await createProperty({ title: `Nhà ${word}`, propertyType: 'HOUSE' });
    const apartment = await createProperty({
      title: `Căn hộ ${word}`,
      propertyType: 'APARTMENT',
      price: 2_000_000_000,
    });
    const land = await createProperty({ title: `Đất ${word}`, propertyType: 'LAND' });
    assert.deepEqual((await search(word, 'agent1', '&propertyType=HOUSE')).ids, [house.id]);
    assert.deepEqual((await search(word, 'agent1', '&propertyType=HOUSE,LAND')).ids, [
      land.id,
      house.id,
    ]);
    assert.deepEqual(
      (await search(word, 'agent1', '&propertyType=APARTMENT&propertyType=LAND')).ids,
      [land.id, apartment.id],
    );
    assert.deepEqual((await search(word, 'agent1', '&propertyType= HOUSE , HOUSE ,')).ids, [
      house.id,
    ]);
    assert.deepEqual(
      (await search(word, 'agent1', '&propertyType=HOUSE,APARTMENT&priceMax=2000000000')).ids,
      [apartment.id],
    );
    assert.deepEqual((await search(word, 'agent1', '&propertyType=VILLA')).ids, []);
  });

  it('loại BĐS sai hoặc rỗng → 400', async () => {
    for (const query of [
      'propertyType=CASTLE',
      'propertyType=HOUSE,house',
      'propertyType=',
      'propertyType=,',
    ]) {
      const response = await request('GET', `/properties?${query}`, undefined, tokens['agent1']);
      assert.equal(response.status, 400, query);
      const error = ((await response.json()) as { error: { details: { field: string }[] } }).error;
      assert.ok(
        error.details.some((detail) => detail.field.startsWith('propertyType')),
        `${query}: ${JSON.stringify(error)}`,
      );
    }
  });

  it('lọc số phòng ngủ, phòng tắm gồm cả hai đầu; BĐS chưa ghi số phòng không khớp', async () => {
    const word = tag();
    const studio = await createProperty({ title: `Nhà ${word}`, bedrooms: 1, bathrooms: 1 });
    const family = await createProperty({ title: `Nhà ${word}`, bedrooms: 3, bathrooms: 2 });
    const villa = await createProperty({
      title: `Nhà ${word}`,
      bedrooms: 5,
      bathrooms: 4,
      price: 9_000_000_000,
    });
    const unknown = await createProperty({ title: `Nhà ${word}` });
    assert.deepEqual((await search(word)).ids, [unknown.id, villa.id, family.id, studio.id]);
    assert.deepEqual((await search(word, 'agent1', '&bedroomsMin=3')).ids, [villa.id, family.id]);
    assert.deepEqual((await search(word, 'agent1', '&bedroomsMax=3')).ids, [family.id, studio.id]);
    assert.deepEqual((await search(word, 'agent1', '&bedroomsMin=3&bedroomsMax=3')).ids, [
      family.id,
    ]);
    assert.deepEqual((await search(word, 'agent1', '&bathroomsMin=2&bathroomsMax=3')).ids, [
      family.id,
    ]);
    assert.deepEqual((await search(word, 'agent1', '&bathroomsMax=0')).ids, []);
    assert.deepEqual(
      (await search(word, 'agent1', '&bedroomsMin=2&priceMax=5000000000&propertyType=HOUSE')).ids,
      [family.id],
    );
  });

  it('số phòng sai: âm, không phải số nguyên, quá lớn, min > max → 400', async () => {
    for (const query of [
      'bedroomsMin=-1',
      'bedroomsMax=2.5',
      'bathroomsMin=abc',
      'bathroomsMax=40000',
      'bedroomsMin=4&bedroomsMax=3',
      'bathroomsMin=2&bathroomsMax=1',
    ]) {
      const response = await request('GET', `/properties?${query}`, undefined, tokens['agent1']);
      assert.equal(response.status, 400, query);
      const error = ((await response.json()) as { error: { details: { field: string }[] } }).error;
      assert.ok(
        error.details.some((detail) => /^b(ed|ath)rooms/.test(detail.field)),
        `${query}: ${JSON.stringify(error)}`,
      );
    }
  });

  it('lọc pháp lý: một hoặc nhiều tình trạng, kết hợp bộ lọc khác; BĐS chưa ghi pháp lý không khớp', async () => {
    const word = tag();
    const pink = await createProperty({ title: `Nhà ${word}`, legalStatus: 'PRIVATE_BOOK' });
    const shared = await createProperty({
      title: `Nhà ${word}`,
      legalStatus: 'SHARED_BOOK',
      price: 1_500_000_000,
    });
    const paper = await createProperty({ title: `Nhà ${word}`, legalStatus: 'HANDWRITTEN' });
    const unknown = await createProperty({ title: `Nhà ${word}` });
    assert.deepEqual((await search(word)).ids, [unknown.id, paper.id, shared.id, pink.id]);
    assert.deepEqual((await search(word, 'agent1', '&legalStatus=PRIVATE_BOOK')).ids, [pink.id]);
    assert.deepEqual((await search(word, 'agent1', '&legalStatus=PRIVATE_BOOK,SHARED_BOOK')).ids, [
      shared.id,
      pink.id,
    ]);
    assert.deepEqual(
      (await search(word, 'agent1', '&legalStatus=HANDWRITTEN&legalStatus=PRIVATE_BOOK')).ids,
      [paper.id, pink.id],
    );
    assert.deepEqual(
      (await search(word, 'agent1', '&legalStatus=PRIVATE_BOOK,SHARED_BOOK&priceMax=2000000000'))
        .ids,
      [shared.id],
    );
    assert.deepEqual((await search(word, 'agent1', '&legalStatus=OTHER')).ids, []);
  });

  it('pháp lý sai hoặc rỗng → 400', async () => {
    for (const query of [
      'legalStatus=RED_BOOK',
      'legalStatus=private_book',
      'legalStatus=',
      'legalStatus=,',
    ]) {
      const response = await request('GET', `/properties?${query}`, undefined, tokens['agent1']);
      assert.equal(response.status, 400, query);
      const error = ((await response.json()) as { error: { details: { field: string }[] } }).error;
      assert.ok(
        error.details.some((detail) => detail.field.startsWith('legalStatus')),
        `${query}: ${JSON.stringify(error)}`,
      );
    }
  });

  it('lọc hướng nhà: một hoặc nhiều hướng, kết hợp bộ lọc khác; BĐS chưa ghi hướng không khớp', async () => {
    const word = tag();
    const east = await createProperty({ title: `Nhà ${word}`, direction: 'E' });
    const southEast = await createProperty({
      title: `Nhà ${word}`,
      direction: 'SE',
      price: 1_500_000_000,
    });
    const west = await createProperty({ title: `Nhà ${word}`, direction: 'W' });
    const unknown = await createProperty({ title: `Nhà ${word}` });
    assert.deepEqual((await search(word)).ids, [unknown.id, west.id, southEast.id, east.id]);
    assert.deepEqual((await search(word, 'agent1', '&direction=E')).ids, [east.id]);
    assert.deepEqual((await search(word, 'agent1', '&direction=E,SE')).ids, [
      southEast.id,
      east.id,
    ]);
    assert.deepEqual((await search(word, 'agent1', '&direction=W&direction=E')).ids, [
      west.id,
      east.id,
    ]);
    assert.deepEqual((await search(word, 'agent1', '&direction=E,SE&priceMax=2000000000')).ids, [
      southEast.id,
    ]);
    assert.deepEqual((await search(word, 'agent1', '&direction=N')).ids, []);
  });

  it('hướng sai hoặc rỗng → 400', async () => {
    for (const query of ['direction=EAST', 'direction=e', 'direction=', 'direction=,']) {
      const response = await request('GET', `/properties?${query}`, undefined, tokens['agent1']);
      assert.equal(response.status, 400, query);
      const error = ((await response.json()) as { error: { details: { field: string }[] } }).error;
      assert.ok(
        error.details.some((detail) => detail.field.startsWith('direction')),
        `${query}: ${JSON.stringify(error)}`,
      );
    }
  });

  it('lọc độ rộng đường (m, số lẻ) gồm cả hai đầu; BĐS chưa ghi độ rộng không khớp', async () => {
    const word = tag();
    const alley = await createProperty({ title: `Nhà ${word}`, roadWidth: 2.5 });
    const car = await createProperty({
      title: `Nhà ${word}`,
      roadWidth: 6,
      price: 1_500_000_000,
    });
    const avenue = await createProperty({ title: `Nhà ${word}`, roadWidth: 12.75 });
    const unknown = await createProperty({ title: `Nhà ${word}` });
    assert.deepEqual((await search(word)).ids, [unknown.id, avenue.id, car.id, alley.id]);
    assert.deepEqual((await search(word, 'agent1', '&roadWidthMin=6')).ids, [avenue.id, car.id]);
    assert.deepEqual((await search(word, 'agent1', '&roadWidthMax=2.5')).ids, [alley.id]);
    assert.deepEqual((await search(word, 'agent1', '&roadWidthMin=2.51&roadWidthMax=12.75')).ids, [
      avenue.id,
      car.id,
    ]);
    assert.deepEqual((await search(word, 'agent1', '&roadWidthMin=4&priceMax=2000000000')).ids, [
      car.id,
    ]);
    assert.deepEqual((await search(word, 'agent1', '&roadWidthMin=12.76')).ids, []);
  });

  it('độ rộng đường sai: âm, không phải số, quá 2 chữ số thập phân, quá lớn, min > max → 400', async () => {
    for (const query of [
      'roadWidthMin=-1',
      'roadWidthMax=abc',
      'roadWidthMin=1.234',
      'roadWidthMax=10000',
      'roadWidthMin=8&roadWidthMax=7.99',
    ]) {
      const response = await request('GET', `/properties?${query}`, undefined, tokens['agent1']);
      assert.equal(response.status, 400, query);
      const error = ((await response.json()) as { error: { details: { field: string }[] } }).error;
      assert.ok(
        error.details.some((detail) => detail.field.startsWith('roadWidth')),
        `${query}: ${JSON.stringify(error)}`,
      );
    }
  });

  it('sắp xếp theo mới nhất, giá, diện tích; cùng giá trị thì mới hơn trước', async () => {
    const word = tag();
    const a = await createProperty({ title: `Nhà ${word}`, price: 3_000_000_000, area: 80 });
    const b = await createProperty({ title: `Nhà ${word}`, price: 1_000_000_000, area: 120 });
    const c = await createProperty({ title: `Nhà ${word}`, price: 3_000_000_000, area: 50 });
    const d = await createProperty({ title: `Nhà ${word}`, price: 5_000_000_000, area: 80 });
    assert.deepEqual((await search(word, 'agent1', '&sort=newest')).ids, [d.id, c.id, b.id, a.id]);
    assert.deepEqual((await search(word, 'agent1', '&sort=price_asc')).ids, [
      b.id,
      c.id,
      a.id,
      d.id,
    ]);
    assert.deepEqual((await search(word, 'agent1', '&sort=price_desc')).ids, [
      d.id,
      c.id,
      a.id,
      b.id,
    ]);
    assert.deepEqual((await search(word, 'agent1', '&sort=area_asc')).ids, [
      c.id,
      d.id,
      a.id,
      b.id,
    ]);
    assert.deepEqual((await search(word, 'agent1', '&sort=area_desc')).ids, [
      b.id,
      d.id,
      a.id,
      c.id,
    ]);
    // Phân trang giữ đúng thứ tự (cùng diện tích 80: d mới hơn a).
    const response = await request(
      'GET',
      `/properties?q=${word}&sort=area_desc&pageSize=2&page=2`,
      undefined,
      tokens['agent1'],
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { data: { id: string }[]; meta: { total: number } };
    assert.deepEqual(
      body.data.map((item) => item.id),
      [a.id, c.id],
    );
    assert.equal(body.meta.total, 4);
  });

  it('có từ khoá thì mặc định xếp theo độ khớp; đúng mã BĐS lên đầu', async () => {
    const word = tag();
    const strong = await createProperty({
      title: `${word} ${word} gần biển`,
      description: `Nhà ${word} hẻm xe hơi`,
    });
    const weak = await createProperty({ title: `Nhà ${word}`, description: 'Nhà đẹp, gần chợ' });
    const middle = await createProperty({ title: `Nhà ${word} ${word}`, description: 'Gần chợ' });
    assert.deepEqual((await search(word)).ids, [strong.id, middle.id, weak.id]);
    assert.deepEqual((await search(word, 'agent1', '&sort=relevance')).ids, [
      strong.id,
      middle.id,
      weak.id,
    ]);
    assert.deepEqual((await search(word, 'agent1', '&sort=newest')).ids, [
      middle.id,
      weak.id,
      strong.id,
    ]);
    // Từ khoá là mã BĐS: chỉ BĐS đó khớp, vẫn trả về bình thường khi xếp theo độ khớp.
    assert.deepEqual((await search(weak.code.toLowerCase())).ids, [weak.id]);
    // relevance không có từ khoá → như newest.
    const response = await request(
      'GET',
      `/properties?pageSize=100&sort=relevance&propertyType=HOUSE`,
      undefined,
      tokens['agent1'],
    );
    assert.equal(response.status, 200);
    const ids = ((await response.json()) as { data: { id: string }[] }).data.map((item) => item.id);
    assert.deepEqual(
      ids.filter((id) => [strong.id, weak.id, middle.id].includes(id)),
      [middle.id, weak.id, strong.id],
    );
  });

  it('sort sai → 400', async () => {
    for (const query of [
      'sort=price',
      'sort=PRICE_ASC',
      'sort=p.price',
      'sort=',
      'sort=newest&sort=price_asc',
    ]) {
      const response = await request('GET', `/properties?${query}`, undefined, tokens['agent1']);
      assert.equal(response.status, 400, query);
      const error = ((await response.json()) as { error: { details: { field: string }[] } }).error;
      assert.ok(
        error.details.some((detail) => detail.field.startsWith('sort')),
        `${query}: ${JSON.stringify(error)}`,
      );
    }
  });

  it('phân trang kết quả lọc + sắp xếp: meta đúng, không trùng không sót, quá trang cuối thì rỗng', async () => {
    const word = tag();
    const created = [];
    for (let index = 0; index < 5; index += 1) {
      created.push(
        await createProperty({
          title: `Nhà ${word}`,
          price: (index % 2) * 1_000_000_000 + 500_000_000,
        }),
      );
    }
    const pageOf = async (page: number) => {
      const response = await request(
        'GET',
        `/properties?q=${word}&priceMax=2000000000&sort=price_asc&pageSize=2&page=${page}`,
        undefined,
        tokens['agent1'],
      );
      assert.equal(response.status, 200);
      return (await response.json()) as {
        data: { id: string }[];
        meta: { page: number; pageSize: number; total: number; totalPages: number };
      };
    };
    const pages = [await pageOf(1), await pageOf(2), await pageOf(3)];
    assert.deepEqual(
      pages.map((page) => page.meta),
      [1, 2, 3].map((page) => ({ page, pageSize: 2, total: 5, totalPages: 3 })),
    );
    const ids = pages.flatMap((page) => page.data.map((item) => item.id));
    // Giá 0,5 tỷ (index chẵn) trước, cùng giá thì mới hơn trước.
    const [p0, p1, p2, p3, p4] = created.map((property) => property.id);
    assert.deepEqual(ids, [p4, p2, p0, p3, p1]);
    const beyond = await pageOf(4);
    assert.deepEqual(beyond.data, []);
    assert.deepEqual(beyond.meta, { page: 4, pageSize: 2, total: 5, totalPages: 3 });
  });

  it('số trang quá lớn → 400 kèm thông báo, không lỗi hệ thống', async () => {
    for (const query of ['page=10001', 'page=1e20', 'page=99999999999999999999']) {
      const response = await request('GET', `/properties?${query}`, undefined, tokens['agent1']);
      assert.equal(response.status, 400, query);
      const error = (
        (await response.json()) as { error: { details: { field: string; message: string }[] } }
      ).error;
      assert.ok(
        error.details.some((detail) => detail.field === 'page' && detail.message.includes('10000')),
        `${query}: ${JSON.stringify(error)}`,
      );
    }
    const last = await request('GET', '/properties?page=10000', undefined, tokens['agent1']);
    assert.equal(last.status, 200);
  });
});
