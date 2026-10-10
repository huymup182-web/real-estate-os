import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { hidePhones, limitHashtags } from '../src/ai/ai-listing.service.js';
import { createApp } from '../src/app.factory.js';
import { hashPassword } from '../src/auth/password.js';
import { type FakeLlm, setEnv, startFakeLlm } from './support/fake-llm.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';
const MISSING = '00000000-0000-4000-8000-000000000000';
const STREET = 'Số 12 đường Trần Phú';
const DESCRIPTION = 'Nhà mới xây, gần chợ Vĩnh Hải. Chủ nhà gọi 0912 345 678.';

function toolReply(input: Record<string, unknown>): { status: number; body: unknown } {
  return {
    status: 200,
    body: {
      content: [{ type: 'tool_use', id: 'tu_1', name: 'property_listing', input }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 600, output_tokens: 400 },
    },
  };
}

/** Công ty A: admin và `noRole` (không có quyền nào); công ty B: `otherAdmin`. BĐS `house` của công ty A. */
describe('AI viết tin đăng POST /api/v1/properties/:id/ai-listing (TASK-136)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let llm: FakeLlm;
  let restoreEnv: () => void;
  let house: string;
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

    const khanhHoa = await insertId(
      `INSERT INTO provinces (code, name) VALUES ('56', 'Khánh Hòa')`,
    );
    const ward = await insertId(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, '22330', 'Vĩnh Hải')`,
      [khanhHoa],
    );
    const tenantA = await register('admin@a.vn');
    tokens['admin'] = await login('admin@a.vn');
    await db.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, 'Không quyền')`,
      [tenantA, 'norole@a.vn', await hashPassword(PASSWORD)],
    );
    tokens['noRole'] = await login('norole@a.vn');
    await register('admin@b.vn');
    tokens['otherAdmin'] = await login('admin@b.vn');

    const created = await request(
      'POST',
      '/properties',
      {
        title: 'Nhà phố Vĩnh Hải',
        description: DESCRIPTION,
        streetAddress: STREET,
        propertyType: 'HOUSE',
        price: 5_000_000_000,
        area: 80,
        bedrooms: 3,
        direction: 'SE',
        legalStatus: 'PRIVATE_BOOK',
        roadAccess: 'CAR',
        provinceId: khanhHoa,
        wardId: ward,
      },
      tokens['admin'],
    );
    assert.equal(created.status, 201, await created.clone().text());
    house = ((await created.json()) as { data: { id: string } }).data.id;
  });

  beforeEach(() => {
    llm.calls.length = 0;
    llm.reply = toolReply({
      title: '  Bán nhà phố   Vĩnh Hải,\n3 phòng ngủ, ô tô vào được  ',
      description:
        '\nNhà mới xây gần chợ Vĩnh Hải.\nGiá 5 tỷ, 80 m², sổ riêng.\nGọi 0912.345.678 để xem nhà.\n',
    });
  });

  after(async () => {
    await app.close();
    await llm.close();
    restoreEnv();
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

  function write(user: string | undefined, payload: unknown = {}, id = house): Promise<Response> {
    return request('POST', `/properties/${id}/ai-listing`, payload, user && tokens[user]);
  }

  it('viết tin từ dữ liệu thật; LLM không nhận địa chỉ chi tiết, số điện thoại; tin trả về cũng ẩn số', async () => {
    const response = await write('admin');
    assert.equal(response.status, 200, await response.clone().text());
    const { data } = (await response.json()) as { data: Record<string, unknown> };
    const code = (data['property'] as { code: string }).code;
    assert.deepEqual(data, {
      property: { id: house, code },
      style: 'PROFESSIONAL',
      title: 'Bán nhà phố Vĩnh Hải, 3 phòng ngủ, ô tô vào được',
      description:
        'Nhà mới xây gần chợ Vĩnh Hải.\nGiá 5 tỷ, 80 m², sổ riêng.\nGọi [đã ẩn số điện thoại] để xem nhà.',
    });

    assert.equal(llm.calls.length, 1);
    const body = llm.calls[0]?.body ?? {};
    assert.deepEqual(body['tool_choice'], { type: 'tool', name: 'property_listing' });
    assert.match(String(body['system']), /Kiểu chuyên nghiệp/);
    assert.match(String(body['system']), /Không bịa giá/);
    const [message] = body['messages'] as { content: string }[];
    assert.ok(message);
    const facts = JSON.parse(message.content) as {
      bat_dong_san: Record<string, unknown>;
      mo_ta: string;
    };
    assert.equal(facts.bat_dong_san['gia'], '5 tỷ');
    assert.equal(facts.bat_dong_san['dien_tich'], '80 m²');
    assert.equal(facts.bat_dong_san['phap_ly'], 'Sổ riêng');
    assert.equal(facts.bat_dong_san['huong'], 'Đông Nam');
    assert.equal(facts.bat_dong_san['khu_vuc'], 'Vĩnh Hải, Khánh Hòa');
    assert.equal(facts.mo_ta, 'Nhà mới xây, gần chợ Vĩnh Hải. Chủ nhà gọi [đã ẩn số điện thoại].');
    assert.doesNotMatch(message.content, /Trần Phú|0912|345 678/);

    const [row] = (await db.query(
      `SELECT feature, status, tool_names FROM ai_requests ORDER BY created_at DESC LIMIT 1`,
    )) as { feature: string; status: string; tool_names: string[] }[];
    assert.deepEqual(row, {
      feature: 'listing_writer',
      status: 'SUCCESS',
      tool_names: ['property_listing'],
    });

    // Chỉ là bản nháp: BĐS không đổi.
    const [property] = (await db.query(`SELECT title, description FROM properties WHERE id = $1`, [
      house,
    ])) as { title: string; description: string }[];
    assert.deepEqual(property, { title: 'Nhà phố Vĩnh Hải', description: DESCRIPTION });
  });

  it('kiểu ngắn gọn đổi hướng dẫn trong system prompt', async () => {
    const response = await write('admin', { style: 'SHORT' });
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { data: { style: string } }).data.style, 'SHORT');
    const system = String(llm.calls[0]?.body['system']);
    assert.match(system, /Kiểu ngắn gọn/);
    assert.doesNotMatch(system, /Kiểu chuyên nghiệp/);
  });

  it('bài Facebook (TASK-137): hướng dẫn riêng, tối đa 5 hashtag, ghi lượt là facebook_post', async () => {
    llm.reply = toolReply({
      title: 'Nhà phố Vĩnh Hải giá 5 tỷ',
      description:
        'Nhà mới xây gần chợ.\nNhắn tin để xem nhà.\n#nhapho #vinhhai #nhatrang #khanhhoa #bannha #sotieng #muaban',
    });
    const response = await write('admin', { style: 'FACEBOOK' });
    assert.equal(response.status, 200, await response.clone().text());
    const { data } = (await response.json()) as { data: { style: string; description: string } };
    assert.equal(data.style, 'FACEBOOK');
    assert.equal(
      data.description,
      'Nhà mới xây gần chợ.\nNhắn tin để xem nhà.\n#nhapho #vinhhai #nhatrang #khanhhoa #bannha',
    );
    const system = String(llm.calls[0]?.body['system']);
    assert.match(system, /Bài đăng Facebook/);
    assert.match(system, /tối đa 5 hashtag/);
    assert.doesNotMatch(system, /không dùng emoji/);
    const [row] = (await db.query(
      `SELECT feature FROM ai_requests ORDER BY created_at DESC LIMIT 1`,
    )) as { feature: string }[];
    assert.equal(row?.feature, 'facebook_post');
  });

  it('cần đăng nhập, quyền property.view, BĐS trong phạm vi xem, style hợp lệ; không gọi LLM khi bị chặn', async () => {
    assert.equal((await write(undefined)).status, 401);
    assert.equal((await write('noRole')).status, 403);
    assert.equal((await write('otherAdmin')).status, 404);
    assert.equal((await write('admin', {}, MISSING)).status, 404);
    assert.equal((await write('admin', {}, 'abc')).status, 400);
    assert.equal((await write('admin', { style: 'INSTAGRAM' })).status, 400);
    assert.equal(llm.calls.length, 0);
  });

  it('AI trả tiêu đề hoặc nội dung trống → 503', async () => {
    for (const input of [{ title: '  ', description: 'Nội dung' }, { title: 'Tiêu đề' }]) {
      llm.reply = toolReply(input);
      const response = await write('admin');
      assert.equal(response.status, 503, JSON.stringify(input));
      const body = (await response.json()) as { error: { code: string } };
      assert.equal(body.error.code, 'SERVICE_UNAVAILABLE');
    }
  });

  it('hidePhones ẩn số điện thoại Việt Nam, giữ giá, diện tích, năm', () => {
    for (const phone of [
      '0912345678',
      '0912 345 678',
      '0912.345.678',
      '090-123-4567',
      '+84912345678',
      '+84 912 345 678',
      '02583812345',
    ]) {
      assert.equal(hidePhones(`Gọi ${phone} nhé`), 'Gọi [đã ẩn số điện thoại] nhé', phone);
    }
    const kept = 'Giá 5.000.000.000 đồng, 80 m², xây năm 2024, hẻm 3 m, mã 01234';
    assert.equal(hidePhones(kept), kept);
  });

  it('limitHashtags giữ số hashtag đầu, bỏ phần còn lại', () => {
    assert.equal(limitHashtags('A\n#a #b #c', 2), 'A\n#a #b');
    assert.equal(limitHashtags('#a giữa #b câu #c', 1), '#a giữa câu');
    assert.equal(limitHashtags('#nhàphố #đẹp', 5), '#nhàphố #đẹp');
  });
});
