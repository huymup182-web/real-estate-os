import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

interface Location {
  id: string;
  code: string;
  name: string;
}

interface ApiError {
  error: { code: string; details?: { field?: string; message: string }[] };
}

describe('/api/v1/locations', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  const tokens: Record<string, string> = {};
  let khanhHoa: string;
  let closed: string;

  before(async () => {
    await useTestDatabase();
    app = await createApp();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    db = app.get(DataSource);

    khanhHoa = await insertId(`INSERT INTO provinces (code, name) VALUES ('56', 'Khánh Hòa')`);
    await insertId(`INSERT INTO provinces (code, name) VALUES ('01', 'Hà Nội')`);
    closed = await insertId(
      `INSERT INTO provinces (code, name, is_active) VALUES ('99', 'Đã nhập', false)`,
    );
    await insertId(`INSERT INTO wards (province_id, code, name) VALUES ($1, '22330', 'Vĩnh Hải')`, [
      khanhHoa,
    ]);
    await insertId(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, '22320', 'Bắc Nha Trang')`,
      [khanhHoa],
    );
    await insertId(
      `INSERT INTO wards (province_id, code, name, is_active) VALUES ($1, '22331', 'Cũ', false)`,
      [khanhHoa],
    );
    await register('admin@a.vn');
    tokens['admin'] = await login('admin@a.vn');
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

  it('tỉnh/thành đang dùng, theo tên; cần đăng nhập', async () => {
    const provinces = await ok<Location[]>(await as('admin', 'GET', '/locations/provinces'));
    assert.deepEqual(
      provinces.map((province) => province.name),
      ['Hà Nội', 'Khánh Hòa'],
    );
    assert.equal((await request('GET', '/locations/provinces')).status, 401);
  });

  it('phường/xã đang dùng của tỉnh; tỉnh sai → 400, không có hoặc ngừng dùng → 404', async () => {
    const wards = await ok<Location[]>(
      await as('admin', 'GET', `/locations/provinces/${khanhHoa}/wards`),
    );
    assert.deepEqual(
      wards.map((ward) => [ward.code, ward.name]),
      [
        ['22320', 'Bắc Nha Trang'],
        ['22330', 'Vĩnh Hải'],
      ],
    );
    await errorOf(await as('admin', 'GET', `/locations/provinces/${closed}/wards`), 404);
    await errorOf(
      await as('admin', 'GET', '/locations/provinces/00000000-0000-4000-8000-000000000000/wards'),
      404,
    );
    await errorOf(await as('admin', 'GET', '/locations/provinces/abc/wards'), 400);
  });
});
