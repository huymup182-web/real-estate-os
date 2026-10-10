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
const CUSTOMER_EMAIL = 'lan@khach.vn';

function toolReply(input: Record<string, unknown>): { status: number; body: unknown } {
  return {
    status: 200,
    body: {
      content: [{ type: 'tool_use', id: 'tu_1', name: 'customer_summary', input }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 900, output_tokens: 200 },
    },
  };
}

/**
 * Công ty A: admin, agent1, agent2 (AGENT). Khách `lan` của agent1 có nhu cầu, ghi chú, cuộc gọi và một lần
 * đổi bước. Công ty B: `otherAdmin`.
 */
describe('AI tóm tắt khách POST /api/v1/customers/:id/ai-summary (TASK-140)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let llm: FakeLlm;
  let restoreEnv: () => void;
  let lan: string;
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
    const hash = await hashPassword(PASSWORD);
    for (const name of ['agent1', 'agent2']) {
      const id = await insertId(
        `INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, $4)`,
        [tenantA, `${name}@a.vn`, hash, `Môi giới ${name}`],
      );
      await db.query(
        `INSERT INTO user_roles (user_id, role_id, tenant_id)
         SELECT $1, id, tenant_id FROM roles WHERE tenant_id = $2 AND code = 'AGENT'`,
        [id, tenantA],
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

    lan = await post('agent1', '/customers', {
      fullName: CUSTOMER_NAME,
      phone: CUSTOMER_PHONE,
      email: CUSTOMER_EMAIL,
      purpose: 'LIVING',
      purchaseTimeline: 'WITHIN_3_MONTHS',
      source: 'FACEBOOK',
      notes: 'Chồng chị gọi 0912 345 678 vào buổi tối.',
    });
    await post('agent1', `/customers/${lan}/preferences`, {
      wardIds: [ward],
      budgetMin: 4_000_000_000,
      budgetMax: 6_000_000_000,
      bedroomsMin: 3,
      propertyTypes: ['HOUSE'],
    });
    await post('agent1', `/customers/${lan}/activities`, {
      type: 'CALL',
      content: 'Khách muốn nhà gần trường, hẹn cuối tuần xem nhà.',
      occurredAt: '2026-10-01T02:00:00.000Z',
    });
    const detail = await request('GET', `/customers/${lan}`, undefined, tokens['agent1']);
    const { updatedAt } = ((await detail.json()) as { data: { updatedAt: string } }).data;
    const changed = await request(
      'POST',
      `/customers/${lan}/status`,
      { status: 'CONTACTED', expectedUpdatedAt: updatedAt },
      tokens['agent1'],
    );
    assert.equal(changed.status, 200, await changed.clone().text());
  });

  beforeEach(() => {
    llm.calls.length = 0;
    llm.reply = toolReply({
      summary: '  Khách cần nhà phố ở Vĩnh Hải 4–6 tỷ, đã liên hệ, hẹn xem nhà cuối tuần.  ',
      keyPoints: ['Muốn gần trường', '', 'Để ở, mua trong 3 tháng', 'a', 'b', 'c', 'd'],
      openQuestions: ['Khách cần mấy phòng tắm?', 'Gọi lại số 0912 345 678'],
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

  function summarize(user: string | undefined, id = lan): Promise<Response> {
    return request('POST', `/customers/${id}/ai-summary`, undefined, user && tokens[user]);
  }

  it('tóm tắt từ nhu cầu, ghi chú, hoạt động; AI không nhận tên, liên hệ của khách', async () => {
    const response = await summarize('agent1');
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(((await response.json()) as { data: unknown }).data, {
      customerId: lan,
      summary: 'Khách cần nhà phố ở Vĩnh Hải 4–6 tỷ, đã liên hệ, hẹn xem nhà cuối tuần.',
      keyPoints: ['Muốn gần trường', 'Để ở, mua trong 3 tháng', 'a', 'b', 'c'],
      openQuestions: ['Khách cần mấy phòng tắm?', 'Gọi lại số [đã ẩn số điện thoại]'],
      activityCount: 2,
    });

    assert.equal(llm.calls.length, 1);
    const body = llm.calls[0]?.body ?? {};
    assert.deepEqual(body['tool_choice'], { type: 'tool', name: 'customer_summary' });
    const content = String((body['messages'] as { content: string }[])[0]?.content);
    const facts = JSON.parse(content) as {
      hom_nay: string;
      khach_hang: Record<string, unknown>;
      nhu_cau: Record<string, unknown>[];
      hoat_dong: Record<string, unknown>[];
    };
    assert.match(facts.hom_nay, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(
      { ...facts.khach_hang, ngay_tao: 'x' },
      {
        buoc: 'Đã liên hệ',
        muc_dich: 'Để ở',
        thoi_gian_mua: 'Trong 3 tháng',
        nguon: 'Facebook',
        ly_do_mat_khach: null,
        ghi_chu: 'Chồng chị gọi [đã ẩn số điện thoại] vào buổi tối.',
        ngay_tao: 'x',
        da_giao_moi_gioi: true,
      },
    );
    assert.deepEqual(facts.nhu_cau, [
      {
        giao_dich: 'Mua',
        loai_bds: ['Nhà phố, nhà riêng'],
        ngan_sach: '4 tỷ – 6 tỷ',
        dien_tich: null,
        phong_ngu_toi_thieu: 3,
        khu_vuc: ['Vĩnh Hải'],
        huong: null,
        phap_ly: null,
        duong_vao_toi_thieu: null,
        dang_bat: true,
      },
    ]);
    // Cũ trước, mới sau; giờ Việt Nam.
    assert.deepEqual(facts.hoat_dong[0], {
      luc: '2026-10-01 09:00',
      loai: 'Gọi điện',
      noi_dung: 'Khách muốn nhà gần trường, hẹn cuối tuần xem nhà.',
    });
    assert.equal(facts.hoat_dong[1]?.['loai'], 'Đổi bước');
    assert.equal(facts.hoat_dong[1]?.['doi_buoc'], 'Mới → Đã liên hệ');
    for (const secret of [
      CUSTOMER_NAME,
      CUSTOMER_PHONE,
      '0901234567',
      CUSTOMER_EMAIL,
      '0912',
      'agent1',
    ]) {
      assert.ok(!content.includes(secret), secret);
    }

    const [row] = (await db.query(
      `SELECT feature, status FROM ai_requests ORDER BY created_at DESC LIMIT 1`,
    )) as { feature: string; status: string }[];
    assert.deepEqual(row, { feature: 'customer_summary', status: 'SUCCESS' });
  });

  it('phạm vi xem khách: ngoài phạm vi → 404, thiếu customer.view → 403; không gọi AI', async () => {
    assert.equal((await summarize('admin')).status, 200);
    llm.calls.length = 0;
    assert.equal((await summarize('agent2')).status, 404);
    assert.equal((await summarize('otherAdmin')).status, 404);
    assert.equal((await summarize('noRole')).status, 403);
    assert.equal((await summarize('agent1', MISSING)).status, 404);
    assert.equal((await summarize('agent1', 'khong-phai-uuid')).status, 400);
    assert.equal((await summarize(undefined)).status, 401);
    assert.equal(llm.calls.length, 0);
  });

  it('AI không trả tóm tắt → 503', async () => {
    llm.reply = toolReply({ summary: ' ', keyPoints: [], openQuestions: [] });
    const response = await summarize('agent1');
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'SERVICE_UNAVAILABLE');
  });
});
