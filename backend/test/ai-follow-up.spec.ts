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
const DAY_MS = 24 * 60 * 60 * 1000;

function toolReply(input: Record<string, unknown>): { status: number; body: unknown } {
  return {
    status: 200,
    body: {
      content: [{ type: 'tool_use', id: 'tu_1', name: 'follow_up_suggestions', input }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 800, output_tokens: 300 },
    },
  };
}

interface Item {
  customer: { id: string; fullName: string; status: string };
  daysSinceContact: number;
  suggestion: { action: string; reason: string; message: string } | null;
}

/**
 * Công ty A: agent1, agent2 (AGENT), `noRole`. Khách của agent1: `viewing` (Đi xem nhà, gọi lần cuối 16 ngày
 * trước), `stale` (Mới, tạo 20 ngày trước), `fresh` (mới tạo), `recent` (tạo lâu, gọi 2 ngày trước), `won`
 * (đã chốt). agent2 có một khách lâu chưa chăm sóc. Công ty B: `otherAdmin` (không có khách).
 */
describe('AI gợi ý chăm sóc POST /api/v1/ai/follow-ups (TASK-141)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let llm: FakeLlm;
  let restoreEnv: () => void;
  let viewing: string;
  let stale: string;
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

    const tenantA = await register('admin@a.vn');
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

    const customer = async (user: string, fullName: string, phone: string, daysAgo: number) => {
      const id = await post(user, '/customers', { fullName, phone, purpose: 'LIVING' });
      await db.query(`UPDATE customers SET created_at = $2 WHERE id = $1`, [
        id,
        new Date(Date.now() - daysAgo * DAY_MS),
      ]);
      return id;
    };
    viewing = await customer('agent1', 'Chị Lan', '+84901234567', 30);
    await db.query(`UPDATE customers SET status = 'VIEWING' WHERE id = $1`, [viewing]);
    await post('agent1', `/customers/${viewing}/activities`, {
      type: 'CALL',
      content: 'Khách thích căn Vĩnh Hải, hẹn gọi lại 0912 345 678.',
      occurredAt: new Date(Date.now() - 16 * DAY_MS).toISOString(),
    });
    await post('agent1', `/customers/${viewing}/preferences`, { budgetMax: 6_000_000_000 });
    stale = await customer('agent1', 'Anh Minh', '+84907654321', 20);
    await customer('agent1', 'Anh Mới', '+84907000001', 0);
    const recent = await customer('agent1', 'Chị Gần', '+84907000002', 40);
    await post('agent1', `/customers/${recent}/activities`, {
      type: 'MESSAGE',
      content: 'Đã gửi ảnh',
      occurredAt: new Date(Date.now() - 2 * DAY_MS).toISOString(),
    });
    const won = await customer('agent1', 'Anh Chốt', '+84907000003', 60);
    await db.query(`UPDATE customers SET status = 'WON' WHERE id = $1`, [won]);
    await customer('agent2', 'Khách của agent2', '+84907000004', 50);
  });

  beforeEach(() => {
    llm.calls.length = 0;
    llm.reply = toolReply({
      suggestions: [
        {
          ref: 'K2',
          action: 'MESSAGE',
          reason: 'Khách mới chưa rõ nhu cầu.',
          message: 'Em chào anh.',
        },
        {
          ref: ' k1 ',
          action: 'CALL',
          reason: ' Khách đã đi xem, 16 ngày chưa gọi. ',
          message: 'Em gọi lại 0912345678 ạ.',
        },
        { ref: 'K1', action: 'MESSAGE', reason: 'Trùng', message: 'Trùng' },
        { ref: 'K9', action: 'CALL', reason: 'Mã lạ', message: 'Mã lạ' },
      ],
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

  async function followUps(user: string | undefined): Promise<Response> {
    return request('POST', '/ai/follow-ups', undefined, user && tokens[user]);
  }

  it('luật chọn khách cần chăm sóc, bước gần chốt trước; AI gợi ý việc làm, không nhận tên hay số điện thoại', async () => {
    const response = await followUps('agent1');
    assert.equal(response.status, 200, await response.clone().text());
    const { data } = (await response.json()) as { data: { thresholdDays: number; items: Item[] } };
    assert.equal(data.thresholdDays, 14);
    assert.deepEqual(
      data.items.map((item) => [item.customer.id, item.customer.status, item.daysSinceContact]),
      [
        [viewing, 'VIEWING', 16],
        [stale, 'NEW', 20],
      ],
    );
    assert.deepEqual(data.items[0]?.suggestion, {
      action: 'CALL',
      reason: 'Khách đã đi xem, 16 ngày chưa gọi.',
      message: 'Em gọi lại [đã ẩn số điện thoại] ạ.',
    });
    assert.deepEqual(data.items[1]?.suggestion, {
      action: 'MESSAGE',
      reason: 'Khách mới chưa rõ nhu cầu.',
      message: 'Em chào anh.',
    });
    assert.equal(data.items[0]?.customer.fullName, 'Chị Lan');

    assert.equal(llm.calls.length, 1);
    const body = llm.calls[0]?.body ?? {};
    assert.deepEqual(body['tool_choice'], { type: 'tool', name: 'follow_up_suggestions' });
    const content = String((body['messages'] as { content: string }[])[0]?.content);
    assert.deepEqual(JSON.parse(content), [
      {
        ma: 'K1',
        buoc: 'Đi xem nhà',
        muc_dich: 'Để ở',
        thoi_gian_mua: null,
        so_ngay_chua_cham_soc: 16,
        so_nhu_cau_dang_bat: 1,
        hoat_dong_gan_nhat: {
          loai: 'Gọi điện',
          noi_dung: 'Khách thích căn Vĩnh Hải, hẹn gọi lại [đã ẩn số điện thoại].',
        },
      },
      {
        ma: 'K2',
        buoc: 'Mới',
        muc_dich: 'Để ở',
        thoi_gian_mua: null,
        so_ngay_chua_cham_soc: 20,
        so_nhu_cau_dang_bat: 0,
        hoat_dong_gan_nhat: null,
      },
    ]);
    for (const secret of ['Chị Lan', 'Anh Minh', '+8490', '0912']) {
      assert.ok(!content.includes(secret), secret);
    }
    const [row] = (await db.query(
      `SELECT feature, status FROM ai_requests ORDER BY created_at DESC LIMIT 1`,
    )) as { feature: string; status: string }[];
    assert.deepEqual(row, { feature: 'follow_up', status: 'SUCCESS' });
  });

  it('gợi ý sai (việc lạ, thiếu câu) thì khách đó không có gợi ý', async () => {
    llm.reply = toolReply({
      suggestions: [
        { ref: 'K1', action: 'VISIT_HOME', reason: 'x', message: 'y' },
        { ref: 'K2', action: 'CALL', reason: '  ', message: 'y' },
      ],
    });
    const response = await followUps('agent1');
    const { data } = (await response.json()) as { data: { items: Item[] } };
    assert.deepEqual(
      data.items.map((item) => item.suggestion),
      [null, null],
    );
  });

  it('không có khách cần chăm sóc thì trả rỗng, không gọi AI, không tính lượt', async () => {
    const before = (await db.query(`SELECT count(*)::int AS n FROM ai_requests`)) as {
      n: number;
    }[];
    const response = await followUps('otherAdmin');
    assert.equal(response.status, 200);
    assert.deepEqual(((await response.json()) as { data: unknown }).data, {
      thresholdDays: 14,
      items: [],
    });
    assert.equal(llm.calls.length, 0);
    const afterRows = (await db.query(`SELECT count(*)::int AS n FROM ai_requests`)) as {
      n: number;
    }[];
    assert.equal(afterRows[0]?.n, before[0]?.n);
  });

  it('chỉ khách trong phạm vi xem; cần customer.view, cần đăng nhập', async () => {
    const response = await followUps('agent2');
    const { data } = (await response.json()) as { data: { items: Item[] } };
    assert.deepEqual(
      data.items.map((item) => item.customer.fullName),
      ['Khách của agent2'],
    );
    llm.calls.length = 0;
    assert.equal((await followUps('noRole')).status, 403);
    assert.equal((await followUps(undefined)).status, 401);
    assert.equal(llm.calls.length, 0);
  });

  it('AI không trả danh sách gợi ý → 503', async () => {
    llm.reply = toolReply({});
    const response = await followUps('agent1');
    assert.equal(response.status, 503);
  });
});
