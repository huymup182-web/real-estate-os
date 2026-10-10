import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { vnMoney } from '../src/ai/property-facts.js';
import { createApp } from '../src/app.factory.js';
import { hashPassword } from '../src/auth/password.js';
import { type FakeLlm, setEnv, startFakeLlm } from './support/fake-llm.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';
const MISSING = '00000000-0000-4000-8000-000000000000';
const STREET = 'Số 12 đường Trần Phú';
const DESCRIPTION = 'Chủ nhà gọi 0912345678';
const CUSTOMER_PHONE = '+84901234567';

function toolReply(input: Record<string, unknown>): { status: number; body: unknown } {
  return {
    status: 200,
    body: {
      content: [{ type: 'tool_use', id: 'tu_1', name: 'match_explanation', input }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 700, output_tokens: 150 },
    },
  };
}

const AI_TEXT = {
  summary: '  Nhà đúng phường Vĩnh Hải, giá 5 tỷ nằm trong ngân sách tối đa 6 tỷ.  ',
  strengths: [
    'Đúng khu vực Vĩnh Hải',
    'Giá 5 tỷ trong ngân sách',
    '3 phòng ngủ đúng yêu cầu',
    '',
    'a',
    'b',
  ],
  concerns: ['Nên hỏi khách về pháp lý'],
  pitch: 'Anh/chị xem căn nhà 3 phòng ngủ ở Vĩnh Hải, giá 5 tỷ.',
};

/**
 * Công ty A: admin, agent1, agent2 (AGENT), `propertyViewer` (chỉ có `property.view`). Khách `wanted` của
 * agent1 cần nhà ở Vĩnh Hải dưới 6 tỷ, 3 phòng ngủ; BĐS `house` do admin tạo ở đó.
 */
describe('AI giải thích matching POST /customers/:id/matching-properties/:pid/ai-explanation (TASK-135)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let llm: FakeLlm;
  let restoreEnv: () => void;
  let house: string;
  let wanted: string;
  let noNeeds: string;
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
      ['propertyViewer', 'PROPERTY_VIEWER'],
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

    const ward = await insertId(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, '22330', 'Vĩnh Hải')`,
      [khanhHoa],
    );
    house = await post('admin', '/properties', {
      title: 'Nhà phố Vĩnh Hải',
      description: DESCRIPTION,
      streetAddress: STREET,
      propertyType: 'HOUSE',
      price: 5_000_000_000,
      area: 80,
      bedrooms: 3,
      direction: 'SE',
      roadAccess: 'CAR',
      provinceId: khanhHoa,
      wardId: ward,
    });
    wanted = await post('agent1', '/customers', { fullName: 'Chị Lan', phone: CUSTOMER_PHONE });
    await post('agent1', `/customers/${wanted}/preferences`, {
      wardIds: [ward],
      budgetMax: 6_000_000_000,
      bedroomsMin: 3,
      propertyTypes: ['HOUSE'],
    });
    noNeeds = await post('agent1', '/customers', { fullName: 'Anh Minh', phone: '+84907654321' });
  });

  beforeEach(() => {
    llm.calls.length = 0;
    llm.reply = toolReply(AI_TEXT);
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

  async function post(user: string, path: string, payload: unknown): Promise<string> {
    const response = await request('POST', path, payload, tokens[user]);
    assert.equal(response.status, 201, await response.clone().text());
    return ((await response.json()) as { data: { id: string } }).data.id;
  }

  function explain(user: string, customerId = wanted, propertyId = house): Promise<Response> {
    return request(
      'POST',
      `/customers/${customerId}/matching-properties/${propertyId}/ai-explanation`,
      undefined,
      tokens[user],
    );
  }

  it('điểm do luật chấm, AI viết giải thích; chỉ gửi AI thông số BĐS và nhu cầu, không có liên hệ', async () => {
    const response = await explain('agent1');
    assert.equal(response.status, 200, await response.clone().text());
    const data = ((await response.json()) as { data: Record<string, unknown> }).data;

    const matches = await request(
      'GET',
      `/customers/${wanted}/matching-properties`,
      undefined,
      tokens['agent1'],
    );
    const [match] = ((await matches.json()) as { data: Record<string, unknown>[] }).data;
    assert.ok(match);
    assert.equal(data['score'], match['score']);
    assert.deepEqual(data['criteria'], match['criteria']);
    assert.deepEqual(data['explanation'], match['explanation']);
    assert.deepEqual(data['property'], {
      id: house,
      code: (match['property'] as { code: string }).code,
      title: 'Nhà phố Vĩnh Hải',
    });
    assert.deepEqual(data['ai'], {
      summary: 'Nhà đúng phường Vĩnh Hải, giá 5 tỷ nằm trong ngân sách tối đa 6 tỷ.',
      strengths: [
        'Đúng khu vực Vĩnh Hải',
        'Giá 5 tỷ trong ngân sách',
        '3 phòng ngủ đúng yêu cầu',
        'a',
      ],
      concerns: ['Nên hỏi khách về pháp lý'],
      pitch: 'Anh/chị xem căn nhà 3 phòng ngủ ở Vĩnh Hải, giá 5 tỷ.',
    });

    assert.equal(llm.calls.length, 1);
    const body = llm.calls[0]?.body ?? {};
    assert.deepEqual(body['tool_choice'], { type: 'tool', name: 'match_explanation' });
    const content = String((body['messages'] as { content: string }[])[0]?.content);
    const facts = JSON.parse(content) as Record<string, Record<string, unknown>>;
    assert.equal(facts['bat_dong_san']?.['gia'], '5 tỷ');
    assert.equal(facts['bat_dong_san']?.['dien_tich'], '80 m²');
    assert.equal(facts['bat_dong_san']?.['huong'], 'Đông Nam');
    assert.equal(facts['bat_dong_san']?.['duong_vao'], 'Ô tô vào được');
    assert.equal(facts['bat_dong_san']?.['khu_vuc'], 'Vĩnh Hải, Khánh Hòa');
    assert.deepEqual(facts['nhu_cau_khach'], {
      loai_bds: ['Nhà phố, nhà riêng'],
      ngan_sach: 'tối đa 6 tỷ',
      dien_tich: null,
      phong_ngu_toi_thieu: 3,
      khu_vuc: ['Vĩnh Hải'],
      phap_ly: null,
      duong_vao_toi_thieu: null,
    });
    assert.equal(facts['diem_phu_hop'], `${String(data['score'])}%`);
    for (const secret of [
      'Chị Lan',
      CUSTOMER_PHONE,
      '0901234567',
      STREET,
      DESCRIPTION,
      '0912345678',
    ]) {
      assert.ok(!content.includes(secret), secret);
    }

    const [row] = (await db.query(
      `SELECT feature, status FROM ai_requests ORDER BY created_at DESC LIMIT 1`,
    )) as { feature: string; status: string }[];
    assert.deepEqual(row, { feature: 'match_explanation', status: 'SUCCESS' });
  });

  it('phạm vi xem như matching: không thấy khách/BĐS → 404, thiếu customer.view → 403; không gọi AI', async () => {
    assert.equal((await explain('agent2')).status, 404);
    assert.equal((await explain('otherAdmin')).status, 404);
    assert.equal((await explain('propertyViewer')).status, 403);
    assert.equal((await explain('agent1', wanted, MISSING)).status, 404);
    assert.equal((await explain('agent1', MISSING)).status, 404);
    assert.equal((await explain('agent1', 'khong-phai-uuid')).status, 400);
    assert.equal(
      (await request('POST', `/customers/${wanted}/matching-properties/${house}/ai-explanation`))
        .status,
      401,
    );
    assert.equal(llm.calls.length, 0);
  });

  it('khách chưa có nhu cầu → 422, không gọi AI', async () => {
    const response = await explain('agent1', noNeeds);
    assert.equal(response.status, 422);
    assert.equal(llm.calls.length, 0);
  });

  it('AI không trả lời giải thích → 503', async () => {
    llm.reply = toolReply({ summary: '  ', strengths: [], concerns: [], pitch: '' });
    assert.equal((await explain('agent1')).status, 503);
    llm.reply = {
      status: 200,
      body: { content: [{ type: 'text', text: 'Xin lỗi' }], stop_reason: 'end_turn' },
    };
    const response = await explain('agent1');
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'SERVICE_UNAVAILABLE');
  });

  it('vnMoney ghi tiền kiểu Việt Nam', () => {
    assert.equal(vnMoney(5_000_000_000), '5 tỷ');
    assert.equal(vnMoney(3_350_000_000), '3,35 tỷ');
    assert.equal(vnMoney(850_000_000), '850 triệu');
    assert.equal(vnMoney(62_500_000), '62,5 triệu');
  });
});
