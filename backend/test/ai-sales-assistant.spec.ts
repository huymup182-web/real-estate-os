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
const STREET = 'Số 12 đường Trần Phú';

function toolReply(input: Record<string, unknown>): { status: number; body: unknown } {
  return {
    status: 200,
    body: {
      content: [{ type: 'tool_use', id: 'tu_1', name: 'sales_assistant', input }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 900, output_tokens: 300 },
    },
  };
}

interface Facts {
  hom_nay: string;
  giao_dich: Record<string, unknown>;
  bat_dong_san: Record<string, unknown>;
  khach_hang: Record<string, unknown> | null;
}

/**
 * Công ty A: agent1, agent2 (AGENT), `dealViewer` (chỉ có `deal.view` toàn công ty), `noRole`. agent1 tạo BĐS
 * `house`, khách `lan` (có nhu cầu, một cuộc gọi) và giao dịch `deal` đang thương lượng. Công ty B: `otherAdmin`.
 */
describe('Trợ lý bán hàng AI POST /api/v1/deals/:id/ai-assistant (TASK-142)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let llm: FakeLlm;
  let restoreEnv: () => void;
  let deal: string;
  let houseCode: string;
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
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'DEAL_VIEWER', 'Xem giao dịch')`,
      [tenantA],
    );
    await db.query(
      `INSERT INTO role_permissions (role_id, permission_id, scope)
       SELECT $1, id, 'COMPANY' FROM permissions WHERE code = 'deal.view'`,
      [viewerRole],
    );
    for (const [name, role] of [
      ['agent1', 'AGENT'],
      ['agent2', 'AGENT'],
      ['dealViewer', 'DEAL_VIEWER'],
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

    const house = await post('agent1', '/properties', {
      title: 'Nhà phố Vĩnh Hải',
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
    const lan = await post('agent1', '/customers', {
      fullName: CUSTOMER_NAME,
      phone: CUSTOMER_PHONE,
      purpose: 'LIVING',
    });
    await post('agent1', `/customers/${lan}/preferences`, {
      wardIds: [ward],
      budgetMax: 5_200_000_000,
    });
    await post('agent1', `/customers/${lan}/activities`, {
      type: 'NEGOTIATION',
      content: 'Khách trả 4,8 tỷ, chủ nhà (0912 345 678) muốn 5 tỷ.',
      occurredAt: '2026-10-05T03:00:00.000Z',
    });
    deal = await post('agent1', '/deals', {
      customerId: lan,
      propertyId: house,
      dealPrice: 4_900_000_000,
      notes: 'Chủ nhà gọi 0912345678 sau 18h.',
    });
  });

  beforeEach(() => {
    llm.calls.length = 0;
    llm.reply = toolReply({
      situation: '  Giao dịch đang thương lượng, hai bên lệch 200 triệu.  ',
      nextSteps: ['Hẹn hai bên gặp trực tiếp', '', 'Chuẩn bị hợp đồng cọc', 'a', 'b', 'c'],
      talkingPoints: ['Nhà sổ riêng, đúng phường khách cần'],
      risks: ['Gọi chủ nhà 0912 345 678 trước khi giá đổi'],
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

  async function post(user: string, path: string, payload: unknown): Promise<string> {
    const response = await request('POST', path, payload, tokens[user]);
    assert.equal(response.status, 201, await response.clone().text());
    return ((await response.json()) as { data: { id: string } }).data.id;
  }

  function assist(user: string | undefined, id = deal): Promise<Response> {
    return request('POST', `/deals/${id}/ai-assistant`, undefined, user && tokens[user]);
  }

  function lastFacts(): { facts: Facts; content: string } {
    const body = llm.calls.at(-1)?.body ?? {};
    const content = String((body['messages'] as { content: string }[])[0]?.content);
    return { facts: JSON.parse(content) as Facts, content };
  }

  it('gợi ý từ giao dịch, BĐS, nhu cầu và hoạt động; AI không nhận tên, liên hệ, địa chỉ', async () => {
    const response = await assist('agent1');
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(((await response.json()) as { data: unknown }).data, {
      dealId: deal,
      situation: 'Giao dịch đang thương lượng, hai bên lệch 200 triệu.',
      nextSteps: ['Hẹn hai bên gặp trực tiếp', 'Chuẩn bị hợp đồng cọc', 'a', 'b'],
      talkingPoints: ['Nhà sổ riêng, đúng phường khách cần'],
      risks: ['Gọi chủ nhà [đã ẩn số điện thoại] trước khi giá đổi'],
    });

    const body = llm.calls[0]?.body ?? {};
    assert.deepEqual(body['tool_choice'], { type: 'tool', name: 'sales_assistant' });
    const { facts, content } = lastFacts();
    assert.deepEqual(
      { ...facts.giao_dich, ngay_tao: 'x' },
      {
        buoc: 'Đang thương lượng',
        gia_chot: '4,9 tỷ',
        tien_coc: null,
        ngay_coc: null,
        ngay_tao: 'x',
        ghi_chu: 'Chủ nhà gọi [đã ẩn số điện thoại] sau 18h.',
      },
    );
    assert.equal(facts.bat_dong_san['gia'], '5 tỷ');
    assert.equal(facts.bat_dong_san['phap_ly'], 'Sổ riêng');
    assert.equal(facts.khach_hang?.['buoc'], 'Mới');
    assert.deepEqual(facts.khach_hang?.['hoat_dong_gan_nhat'], [
      {
        ngay: '2026-10-05',
        loai: 'Thương lượng',
        noi_dung: 'Khách trả 4,8 tỷ, chủ nhà ([đã ẩn số điện thoại]) muốn 5 tỷ.',
      },
    ]);
    assert.equal((facts.khach_hang?.['nhu_cau'] as unknown[]).length, 1);
    for (const secret of [CUSTOMER_NAME, CUSTOMER_PHONE, '0901234567', '0912', STREET, 'agent1']) {
      assert.ok(!content.includes(secret), secret);
    }
    const [row] = (await db.query(
      `SELECT feature, status FROM ai_requests ORDER BY created_at DESC LIMIT 1`,
    )) as { feature: string; status: string }[];
    assert.deepEqual(row, { feature: 'sales_assistant', status: 'SUCCESS' });
  });

  it('chỉ xem được giao dịch, không xem được BĐS/khách: AI chỉ nhận mã, tiêu đề BĐS', async () => {
    const response = await assist('dealViewer');
    assert.equal(response.status, 200, await response.clone().text());
    const { facts } = lastFacts();
    assert.deepEqual(facts.bat_dong_san, { ma: houseCode, tieu_de: 'Nhà phố Vĩnh Hải' });
    assert.equal(facts.khach_hang, null);
  });

  it('phạm vi deal.view: ngoài phạm vi → 404, thiếu quyền → 403; không gọi AI', async () => {
    assert.equal((await assist('agent2')).status, 404);
    assert.equal((await assist('otherAdmin')).status, 404);
    assert.equal((await assist('noRole')).status, 403);
    assert.equal((await assist('agent1', MISSING)).status, 404);
    assert.equal((await assist('agent1', 'khong-phai-uuid')).status, 400);
    assert.equal((await assist(undefined)).status, 401);
    assert.equal(llm.calls.length, 0);
  });

  it('AI không trả gợi ý → 503', async () => {
    llm.reply = toolReply({ situation: '', nextSteps: [], talkingPoints: [], risks: [] });
    assert.equal((await assist('agent1')).status, 503);
  });
});
