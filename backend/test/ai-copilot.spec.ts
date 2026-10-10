import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { hashPassword } from '../src/auth/password.js';
import { type FakeLlm, setEnv, startFakeLlm } from './support/fake-llm.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';
const MISSING = '00000000-0000-4000-8000-000000000000';
const CUSTOMER_NAME = 'Chị Lan';
const CUSTOMER_PHONE = '+84901234567';
const OLD_CUSTOMER_NAME = 'Anh Tùng';
const STREET = 'Số 12 đường Trần Phú';
const ALL_TOOLS = [
  'search_properties',
  'get_property',
  'current_customer',
  'matching_properties',
  'follow_up_customers',
];

interface Reply {
  status: number;
  body: unknown;
}

let toolId = 0;
function toolUse(...calls: [string, Record<string, unknown>][]): Reply {
  return {
    status: 200,
    body: {
      content: [
        { type: 'text', text: 'Để em xem dữ liệu.' },
        ...calls.map(([name, input]) => ({
          type: 'tool_use',
          id: `tu_${String((toolId += 1))}`,
          name,
          input,
        })),
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 800, output_tokens: 80 },
    },
  };
}

function answer(text: string): Reply {
  return {
    status: 200,
    body: {
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1200, output_tokens: 200 },
    },
  };
}

interface Block {
  type: string;
  text?: string;
  name?: string;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

interface SentMessage {
  role: string;
  content: string | Block[];
}

/**
 * Công ty A: agent1, agent2 (AGENT), `propertyViewer` (chỉ `property.view` toàn công ty), `noRole`. agent1 tạo
 * BĐS `house`, khách `lan` (nhu cầu, một cuộc gọi gần đây) và khách `tung` 30 ngày chưa chăm sóc. Công ty B:
 * `otherAdmin`.
 */
describe('AI Copilot POST /api/v1/ai/copilot (TASK-143)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let llm: FakeLlm;
  let restoreEnv: () => void;
  let house: string;
  let houseCode: string;
  let lan: string;
  let tung: string;
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
        [tenantA, `${name}@a.vn`, hash, `Người ${name}`],
      );
      await db.query(
        `INSERT INTO user_roles (user_id, role_id, tenant_id)
         SELECT $1, id, tenant_id FROM roles WHERE tenant_id = $2 AND code = $3`,
        [id, tenantA, role],
      );
      tokens[name] = await login(`${name}@a.vn`);
    }
    await db.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, 'Không quyền')`,
      [tenantA, 'norole@a.vn', hash],
    );
    tokens['noRole'] = await login('norole@a.vn');
    await register('admin@b.vn');
    tokens['otherAdmin'] = await login('admin@b.vn');

    house = await post('agent1', '/properties', {
      title: 'Nhà phố Vĩnh Hải',
      description: 'Nhà mới xây, chủ nhà Bác Hai 0912 345 678.',
      streetAddress: STREET,
      propertyType: 'HOUSE',
      price: 5_000_000_000,
      area: 80,
      bedrooms: 3,
      legalStatus: 'PRIVATE_BOOK',
      provinceId: khanhHoa,
      wardId: ward,
    });
    const [row] = (await db.query(`SELECT code FROM properties WHERE id = $1`, [house])) as {
      code: string;
    }[];
    houseCode = row?.code ?? '';
    lan = await post('agent1', '/customers', {
      fullName: CUSTOMER_NAME,
      phone: CUSTOMER_PHONE,
      purpose: 'LIVING',
    });
    await post('agent1', `/customers/${lan}/preferences`, {
      wardIds: [ward],
      budgetMax: 5_200_000_000,
    });
    await post('agent1', `/customers/${lan}/activities`, {
      type: 'CALL',
      content: 'Khách hẹn xem nhà cuối tuần, gọi lại số 0987 654 321.',
      occurredAt: new Date().toISOString(),
    });
    tung = await post('agent1', '/customers', {
      fullName: OLD_CUSTOMER_NAME,
      phone: '+84933111222',
    });
    await db.query(`UPDATE customers SET created_at = now() - interval '30 days' WHERE id = $1`, [
      tung,
    ]);
  });

  beforeEach(() => {
    llm.calls.length = 0;
    llm.queue.length = 0;
    llm.reply = answer('Em chưa rõ, anh chị hỏi lại giúp em.');
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

  function ask(user: string | undefined, payload: unknown): Promise<Response> {
    return request('POST', '/ai/copilot', payload, user && tokens[user]);
  }

  function question(content: string, context?: Record<string, string>): unknown {
    return { messages: [{ role: 'user', content }], ...(context ? { context } : {}) };
  }

  function toolNames(call = 0): string[] {
    const tools = (llm.calls[call]?.body['tools'] ?? []) as { name: string }[];
    return tools.map((tool) => tool.name);
  }

  /** Các tool_result backend gửi lại LLM ở lượt gọi `call`. */
  function toolResults(call: number): Block[] {
    const messages = (llm.calls[call]?.body['messages'] ?? []) as SentMessage[];
    const last = messages.at(-1)?.content;
    return Array.isArray(last) ? last.filter((block) => block.type === 'tool_result') : [];
  }

  it('gọi tool nhiều bước qua service, trả lời và thẻ BĐS; LLM không nhận tên, liên hệ, địa chỉ', async () => {
    llm.queue.push(
      toolUse(['current_customer', {}], ['matching_properties', {}]),
      toolUse(
        ['search_properties', { province: 'Khánh Hòa', priceMax: 6e9 }],
        ['get_property', { code: houseCode.toLowerCase() }],
      ),
      answer(`  Căn ${houseCode} hợp với khách. Chủ nhà: 0912 345 678.  `),
    );
    const response = await ask(
      'agent1',
      question('Tìm nhà phù hợp khách này, số khách 0901 234 567', { customerId: lan }),
    );
    assert.equal(response.status, 200, await response.clone().text());
    const { data } = (await response.json()) as { data: Record<string, unknown> };
    assert.deepEqual(data, {
      reply: `Căn ${houseCode} hợp với khách. Chủ nhà: [đã ẩn số điện thoại].`,
      toolsUsed: ['current_customer', 'matching_properties', 'search_properties', 'get_property'],
      properties: [
        {
          id: house,
          code: houseCode,
          title: 'Nhà phố Vĩnh Hải',
          transactionType: 'SALE',
          propertyType: 'HOUSE',
          price: 5_000_000_000,
          area: 80,
        },
      ],
      customers: [],
    });

    assert.equal(llm.calls.length, 3);
    assert.deepEqual(toolNames(), ALL_TOOLS);
    assert.equal(llm.calls[0]?.body['tool_choice'], undefined);
    assert.match(String(llm.calls[0]?.body['system']), /đang xem một khách hàng/);
    const first = (llm.calls[0]?.body['messages'] as SentMessage[])[0];
    assert.equal(first?.content, 'Tìm nhà phù hợp khách này, số khách [đã ẩn số điện thoại]');

    const [customer, matches] = toolResults(1).map((block) => JSON.parse(String(block.content)));
    assert.equal(customer.khach_hang.buoc, 'Mới');
    assert.equal(
      customer.hoat_dong[0].noi_dung,
      'Khách hẹn xem nhà cuối tuần, gọi lại số [đã ẩn số điện thoại].',
    );
    assert.deepEqual(matches, [
      {
        ma: houseCode,
        tieu_de: 'Nhà phố Vĩnh Hải',
        gia: '5 tỷ',
        dien_tich: '80 m²',
        diem_phu_hop: matches[0].diem_phu_hop,
      },
    ]);
    const [search, detail] = toolResults(2).map((block) => JSON.parse(String(block.content)));
    assert.equal(search.tong_so_ket_qua, 1);
    assert.equal(search.bds[0].ma, houseCode);
    assert.equal(search.bds[0].trang_thai, 'Đang bán');
    assert.equal(search.bds[0].so_ngay_da_dang, 0);
    assert.equal(detail.mo_ta, 'Nhà mới xây, chủ nhà Bác Hai [đã ẩn số điện thoại].');

    const sent = JSON.stringify(llm.calls.map((call) => call.body['messages']));
    for (const secret of [
      CUSTOMER_NAME,
      CUSTOMER_PHONE,
      '0901',
      '0912',
      '0987',
      STREET,
      'agent1',
    ]) {
      assert.ok(!sent.includes(secret), secret);
    }
    const rows = (await db.query(
      `SELECT feature, status, tool_names FROM ai_requests ORDER BY created_at DESC LIMIT 3`,
    )) as { feature: string; status: string }[];
    assert.deepEqual(
      rows.map((row) => [row.feature, row.status]),
      [
        ['copilot', 'SUCCESS'],
        ['copilot', 'SUCCESS'],
        ['copilot', 'SUCCESS'],
      ],
    );
  });

  it('khách cần chăm sóc: LLM chỉ thấy mã K1, app nhận tên theo mã', async () => {
    llm.queue.push(toolUse(['follow_up_customers', {}]), answer('Nên gọi K1 hôm nay.'));
    const response = await ask('agent1', {
      messages: [
        { role: 'user', content: 'Chào em' },
        { role: 'assistant', content: 'Em chào anh chị.' },
        { role: 'user', content: 'Khách nào cần follow-up hôm nay?' },
      ],
    });
    assert.equal(response.status, 200, await response.clone().text());
    const { data } = (await response.json()) as { data: Record<string, unknown> };
    assert.equal(data['reply'], 'Nên gọi K1 hôm nay.');
    assert.deepEqual(data['customers'], [
      { ref: 'K1', id: tung, fullName: OLD_CUSTOMER_NAME, status: 'NEW' },
    ]);
    // Không mở khách nào thì không có tool của khách đang mở.
    assert.deepEqual(toolNames(), ['search_properties', 'get_property', 'follow_up_customers']);
    const [result] = toolResults(1);
    const facts = JSON.parse(String(result?.content)) as Record<string, unknown>[];
    assert.equal(facts[0]?.['ma'], 'K1');
    assert.ok(!String(result?.content).includes(OLD_CUSTOMER_NAME));
    assert.equal((llm.calls[0]?.body['messages'] as SentMessage[]).length, 3);
  });

  it('BĐS đang xem vào system prompt; mã lạ, tool lạ trả lỗi tool cho LLM', async () => {
    llm.queue.push(
      toolUse(['get_property', { code: 'BDS-999999' }], ['matching_properties', {}]),
      answer('Không tìm thấy căn đó.'),
    );
    const response = await ask('agent1', question('Viết tin cho căn này', { propertyId: house }));
    assert.equal(response.status, 200, await response.clone().text());
    assert.match(String(llm.calls[0]?.body['system']), new RegExp(`đang xem BĐS mã ${houseCode}`));
    assert.deepEqual(
      toolResults(1).map((block) => [block.is_error, block.content]),
      [
        [true, 'Không tìm thấy BĐS mã "BDS-999999" trong phạm vi người dùng xem được'],
        [true, 'Không có tool matching_properties'],
      ],
    );
    const { data } = (await response.json()) as { data: Record<string, unknown> };
    assert.deepEqual(data['toolsUsed'], ['get_property']);
  });

  it('LLM gọi tool mãi: tối đa 4 lượt gọi, lượt cuối cấm gọi tool', async () => {
    llm.reply = toolUse(['search_properties', {}]);
    llm.queue.push(
      toolUse(['search_properties', {}]),
      toolUse(['search_properties', {}]),
      toolUse(['search_properties', {}]),
      answer('Đây là các căn em tìm được.'),
    );
    const response = await ask('propertyViewer', question('Căn nào dễ thương lượng?'));
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(llm.calls.length, 4);
    assert.deepEqual(llm.calls[3]?.body['tool_choice'], { type: 'none' });
    assert.deepEqual(toolNames(), ['search_properties', 'get_property']);
  });

  it('quyền và phạm vi: thiếu quyền → 403, ngữ cảnh ngoài phạm vi → 404; không gọi AI', async () => {
    assert.equal((await ask('noRole', question('Xin chào'))).status, 403);
    assert.equal(
      (await ask('propertyViewer', question('Khách này?', { customerId: lan }))).status,
      403,
    );
    assert.equal((await ask('agent2', question('Khách này?', { customerId: lan }))).status, 404);
    assert.equal(
      (await ask('otherAdmin', question('Căn này?', { propertyId: house }))).status,
      404,
    );
    assert.equal((await ask('agent1', question('Căn này?', { propertyId: MISSING }))).status, 404);
    assert.equal((await ask(undefined, question('Xin chào'))).status, 401);
    assert.equal(llm.calls.length, 0);
  });

  it('kiểm hội thoại: phải bắt đầu, kết thúc bằng câu hỏi, xen kẽ, tối đa 20 lượt → 400', async () => {
    const turns = (roles: string[]) => ({
      messages: roles.map((role) => ({ role, content: 'câu' })),
    });
    for (const payload of [
      { messages: [] },
      turns(['assistant', 'user']),
      turns(['user', 'assistant']),
      turns(['user', 'user']),
      turns(Array.from({ length: 21 }, (_, i) => (i % 2 ? 'assistant' : 'user'))),
      { messages: [{ role: 'system', content: 'câu' }] },
      { messages: [{ role: 'user', content: '   ' }] },
      question('Xin chào', { customerId: 'khong-phai-uuid' }),
    ]) {
      assert.equal((await ask('agent1', payload)).status, 400, JSON.stringify(payload));
    }
    assert.equal(llm.calls.length, 0);
  });

  it('AI không trả lời chữ → 503', async () => {
    llm.reply = answer('   ');
    assert.equal((await ask('agent1', question('Xin chào'))).status, 503);
  });
});
