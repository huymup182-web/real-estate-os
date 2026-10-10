import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { normalizePlaceName } from '../src/ai/ai-property-search.service.js';
import { createApp } from '../src/app.factory.js';
import { hashPassword } from '../src/auth/password.js';
import { type FakeLlm, setEnv, startFakeLlm } from './support/fake-llm.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

/** Phản hồi LLM gọi tool bộ lọc với tham số `input`. */
function toolReply(input: Record<string, unknown>): { status: number; body: unknown } {
  return {
    status: 200,
    body: {
      content: [{ type: 'tool_use', id: 'tu_1', name: 'property_search_filter', input }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 400, output_tokens: 80 },
    },
  };
}

/** Công ty A: admin (`admin`) và `noRole` (không có role nào nên không có `property.view`). */
describe('Tìm BĐS bằng câu tự nhiên POST /api/v1/ai/property-search (TASK-134)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let llm: FakeLlm;
  let restoreEnv: () => void;
  let khanhHoa: string;
  let daNang: string;
  let vinhHai: string;
  const tokens: Record<string, string> = {};

  before(async () => {
    llm = await startFakeLlm();
    restoreEnv = setEnv({ AI_API_KEY: 'sk-test', AI_BASE_URL: llm.url });
    await useTestDatabase();
    app = await createApp();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
    db = app.get(DataSource);

    khanhHoa = await insertId(`INSERT INTO provinces (code, name) VALUES ('56', 'Khánh Hòa')`);
    daNang = await insertId(
      `INSERT INTO provinces (code, name) VALUES ('48', 'Thành phố Đà Nẵng')`,
    );
    vinhHai = await insertId(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, '22330', 'Phường Vĩnh Hải')`,
      [khanhHoa],
    );
    await insertId(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, '22331', 'Nha Trang')`,
      [khanhHoa],
    );
    // Hai phường trùng tên ở hai tỉnh: không nêu tỉnh thì không biết chọn phường nào.
    await insertId(`INSERT INTO wards (province_id, code, name) VALUES ($1, '20001', 'Hòa Minh')`, [
      khanhHoa,
    ]);
    await insertId(`INSERT INTO wards (province_id, code, name) VALUES ($1, '20002', 'Hòa Minh')`, [
      daNang,
    ]);

    const registered = await request('POST', '/auth/register', {
      companyName: 'Công ty A',
      fullName: 'Quản trị',
      email: 'admin@ai-search.vn',
      password: PASSWORD,
    });
    assert.equal(registered.status, 201);
    const tenantId = ((await registered.json()) as { data: { company: { id: string } } }).data
      .company.id;
    await db.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, 'Không quyền')`,
      [tenantId, 'norole@ai-search.vn', await hashPassword(PASSWORD)],
    );
    tokens['admin'] = await login('admin@ai-search.vn');
    tokens['noRole'] = await login('norole@ai-search.vn');
  });

  beforeEach(() => {
    llm.calls.length = 0;
  });

  after(async () => {
    await app.close();
    await llm.close();
    restoreEnv();
  });

  async function insertId(sql: string, params: unknown[] = []): Promise<string> {
    const rows = (await db.query(`${sql} RETURNING id`, params)) as { id: string }[];
    const id = rows[0]?.id;
    assert.ok(id);
    return id;
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

  async function aiSearch(
    input: Record<string, unknown>,
    query = 'nhà khoảng 5 tỷ ở Nha Trang',
  ): Promise<{ filters: Record<string, unknown>; explanation: string; unresolved: string[] }> {
    llm.reply = toolReply(input);
    const response = await request('POST', '/ai/property-search', { query }, tokens['admin']);
    assert.equal(response.status, 200, await response.clone().text());
    return ((await response.json()) as { data: never }).data;
  }

  it('đổi câu tự nhiên thành bộ lọc của GET /properties; LLM chỉ nhận câu hỏi, không nhận dữ liệu', async () => {
    const query = 'Tìm nhà khoảng 5 tỷ ở Nha Trang, 3 phòng ngủ, ô tô vào được.';
    const result = await aiSearch(
      {
        explanation: 'Nhà ở Nha Trang, giá khoảng 5 tỷ, từ 3 phòng ngủ, ô tô vào được.',
        province: 'Khánh Hòa',
        place: 'Nha Trang',
        priceMin: 4_500_000_000,
        priceMax: 5_500_000_000,
        propertyType: ['HOUSE'],
        bedroomsMin: 3,
        roadAccess: ['CAR'],
      },
      query,
    );
    assert.deepEqual(result, {
      filters: {
        provinceId: khanhHoa,
        priceMin: 4_500_000_000,
        priceMax: 5_500_000_000,
        propertyType: ['HOUSE'],
        bedroomsMin: 3,
        roadAccess: ['CAR'],
      },
      explanation: 'Nhà ở Nha Trang, giá khoảng 5 tỷ, từ 3 phòng ngủ, ô tô vào được.',
      unresolved: ['Nha Trang'],
    });

    assert.equal(llm.calls.length, 1);
    const body = llm.calls[0]?.body ?? {};
    assert.deepEqual(body['messages'], [{ role: 'user', content: query }]);
    assert.deepEqual(body['tool_choice'], { type: 'tool', name: 'property_search_filter' });
    assert.match(String(body['system']), /không truy cập dữ liệu/);

    const params = new URLSearchParams(
      Object.entries(result.filters).map(([key, value]): [string, string] => [key, String(value)]),
    );
    const list = await request(
      'GET',
      `/properties?${params.toString()}`,
      undefined,
      tokens['admin'],
    );
    assert.equal(list.status, 200);

    const [row] = (await db.query(
      `SELECT feature, status, tool_names FROM ai_requests ORDER BY created_at DESC LIMIT 1`,
    )) as { feature: string; status: string; tool_names: string[] }[];
    assert.deepEqual(row, {
      feature: 'property_search',
      status: 'SUCCESS',
      tool_names: ['property_search_filter'],
    });
  });

  it('đổi tên khu vực ra id: bỏ dấu, hoa thường, tiền tố tỉnh/thành phố/phường', async () => {
    assert.deepEqual((await aiSearch({ explanation: 'x', ward: 'phuong vinh hai' })).filters, {
      provinceId: khanhHoa,
      wardId: vinhHai,
    });
    assert.deepEqual((await aiSearch({ explanation: 'x', province: 'TP. Đà Nẵng' })).filters, {
      provinceId: daNang,
    });
    // Địa danh trùng tên tỉnh thì lọc theo tỉnh.
    assert.deepEqual(await aiSearch({ explanation: 'x', place: 'Đà Nẵng' }), {
      filters: { provinceId: daNang },
      explanation: 'x',
      unresolved: [],
    });
    // Phường trùng tên ở hai tỉnh: nêu tỉnh thì chọn được, không nêu thì chưa lọc.
    const withProvince = await aiSearch({
      explanation: 'x',
      province: 'Đà Nẵng',
      ward: 'Hòa Minh',
    });
    assert.equal(withProvince.filters['provinceId'], daNang);
    assert.equal(typeof withProvince.filters['wardId'], 'string');
    assert.deepEqual(await aiSearch({ explanation: 'x', ward: 'Hòa Minh' }), {
      filters: {},
      explanation: 'x',
      unresolved: ['Hòa Minh'],
    });
    // Phường không thuộc tỉnh đã nêu, tỉnh không có trong danh mục.
    assert.deepEqual(await aiSearch({ explanation: 'x', province: 'Đà Nẵng', ward: 'Vĩnh Hải' }), {
      filters: { provinceId: daNang },
      explanation: 'x',
      unresolved: ['Vĩnh Hải'],
    });
    assert.deepEqual(await aiSearch({ explanation: 'x', province: 'Sao Hỏa' }), {
      filters: {},
      explanation: 'x',
      unresolved: ['Sao Hỏa'],
    });
  });

  it('LLM điền sai thì bỏ trường sai, giữ trường đúng; bỏ trường lạ; từ khoá vào q', async () => {
    const result = await aiSearch({
      explanation: 'Căn hộ view biển',
      keyword: '  view biển  ',
      priceMin: 6_000_000_000,
      priceMax: 5_000_000_000,
      propertyType: ['APARTMENT', 'CASTLE'],
      bedroomsMin: 2.6,
      direction: ['SE'],
      sort: 'cheapest',
      provinceId: '00000000-0000-4000-8000-000000000000',
      hack: 'DROP TABLE properties',
    });
    assert.deepEqual(result, {
      filters: { q: 'view biển', priceMin: 6_000_000_000, bedroomsMin: 3, direction: ['SE'] },
      explanation: 'Căn hộ view biển',
      unresolved: [],
    });
  });

  it('LLM không gọi tool bộ lọc → 503, không đoán', async () => {
    llm.reply = {
      status: 200,
      body: { content: [{ type: 'text', text: 'Xin lỗi' }], stop_reason: 'end_turn' },
    };
    const response = await request(
      'POST',
      '/ai/property-search',
      { query: 'nhà đẹp' },
      tokens['admin'],
    );
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'SERVICE_UNAVAILABLE');
  });

  it('cần đăng nhập và quyền property.view; câu tìm kiếm 2–500 ký tự; không gọi LLM khi bị chặn', async () => {
    assert.equal((await request('POST', '/ai/property-search', { query: 'nhà' })).status, 401);
    const forbidden = await request(
      'POST',
      '/ai/property-search',
      { query: 'nhà đẹp' },
      tokens['noRole'],
    );
    assert.equal(forbidden.status, 403);
    for (const payload of [{}, { query: ' a ' }, { query: 'x'.repeat(501) }, { query: 5 }]) {
      const response = await request('POST', '/ai/property-search', payload, tokens['admin']);
      assert.equal(response.status, 400, JSON.stringify(payload));
    }
    assert.equal(llm.calls.length, 0);
  });

  it('normalizePlaceName bỏ dấu, tiền tố đơn vị hành chính', () => {
    assert.equal(normalizePlaceName('Thành phố Hồ Chí Minh'), 'ho chi minh');
    assert.equal(normalizePlaceName('TP.HCM'), 'hcm');
    assert.equal(normalizePlaceName('Phường Đống Đa'), 'dong da');
    assert.equal(normalizePlaceName('Đặc khu Phú Quốc'), 'phu quoc');
    assert.equal(normalizePlaceName('Xã Phước Đồng'), 'phuoc dong');
  });
});
