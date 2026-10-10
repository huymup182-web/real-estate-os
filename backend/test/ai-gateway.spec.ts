import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AiGatewayService } from '../src/ai/ai-gateway.service.js';
import { createApp } from '../src/app.factory.js';
import type { AuthenticatedUser } from '../src/auth/access-token.service.js';
import { AppException } from '../src/common/errors/app.exception.js';
import { ErrorCode } from '../src/common/errors/error-code.js';
import type { AppConfig } from '../src/config/app-config.js';
import { type FakeLlm, startFakeLlm, setEnv } from './support/fake-llm.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';
const API_KEY = 'sk-ant-khoa-test';
const DAILY_LIMIT = 3;

interface AiRequestRow {
  tenant_id: string | null;
  user_id: string;
  feature: string;
  provider: string;
  model: string;
  status: string;
  input_tokens: number | null;
  output_tokens: number | null;
  tool_names: string[];
  error_code: string | null;
}

/** Máy chủ Anthropic giả trả lời theo `reply`; app trỏ tới nó qua AI_BASE_URL. */
describe('AI gateway (TASK-133)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let gateway: AiGatewayService;
  let llm: FakeLlm;
  let restoreEnv: () => void;
  const users: Record<string, AuthenticatedUser> = {};
  const tokens: Record<string, string> = {};

  before(async () => {
    llm = await startFakeLlm();
    restoreEnv = setEnv({
      AI_API_KEY: API_KEY,
      AI_BASE_URL: llm.url,
      AI_MODEL: 'claude-test',
      AI_USER_DAILY_LIMIT: String(DAILY_LIMIT),
    });

    await useTestDatabase();
    app = await createApp();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    db = app.get(DataSource);
    gateway = app.get(AiGatewayService);

    for (const name of ['a', 'b']) {
      const email = `${name}@ai-gateway.vn`;
      const registered = await request('POST', '/auth/register', {
        companyName: `Công ty ${name}`,
        fullName: 'Quản trị',
        email,
        password: PASSWORD,
      });
      assert.equal(registered.status, 201);
      const data = (
        (await registered.json()) as { data: { user: { id: string }; company: { id: string } } }
      ).data;
      users[name] = { userId: data.user.id, tenantId: data.company.id, sessionId: 'test' };
      const login = await request('POST', '/auth/login', { identifier: email, password: PASSWORD });
      tokens[name] = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
    }
  });

  beforeEach(async () => {
    llm.calls.length = 0;
    llm.reply = { status: 200, body: okBody() };
    await db.query('DELETE FROM ai_requests');
  });

  after(async () => {
    await app.close();
    await llm.close();
    restoreEnv();
  });

  function userOf(name: string): AuthenticatedUser {
    const user = users[name];
    assert.ok(user, name);
    return user;
  }

  function okBody(): unknown {
    return {
      content: [
        { type: 'text', text: 'Đây là bộ lọc' },
        { type: 'tool_use', id: 'tu_1', name: 'search_filter', input: { bedroomsMin: 3 } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 50, output_tokens: 12 },
    };
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

  function complete(user: AuthenticatedUser, maxTokens?: number) {
    return gateway.complete(user, {
      feature: 'search',
      system: 'Đổi câu hỏi thành bộ lọc',
      messages: [{ role: 'user', content: 'nhà 3 phòng ngủ khách Nguyễn Văn A 0901234567' }],
      tools: [{ name: 'search_filter', description: 'Bộ lọc', inputSchema: { type: 'object' } }],
      forceTool: 'search_filter',
      maxTokens,
    });
  }

  async function rows(): Promise<AiRequestRow[]> {
    return db.query(
      `SELECT tenant_id, user_id, feature, provider, model, status, input_tokens, output_tokens,
              tool_names, error_code
         FROM ai_requests ORDER BY created_at`,
    );
  }

  async function status(name: string): Promise<Record<string, unknown>> {
    const response = await request('GET', '/ai/status', undefined, tokens[name]);
    assert.equal(response.status, 200);
    return ((await response.json()) as { data: Record<string, unknown> }).data;
  }

  function isAppError(code: ErrorCode, status: number) {
    return (error: unknown) => {
      assert.ok(error instanceof AppException);
      assert.equal(error.code, code);
      assert.equal(error.getStatus(), status);
      assert.ok(!error.message.includes(API_KEY));
      return true;
    };
  }

  it('GET /ai/status cần đăng nhập; trả số lượt còn lại', async () => {
    assert.equal((await request('GET', '/ai/status')).status, 401);
    assert.deepEqual(await status('a'), {
      enabled: true,
      dailyLimit: DAILY_LIMIT,
      used: 0,
      remaining: DAILY_LIMIT,
    });
  });

  it('gọi LLM qua backend: API key chỉ ở header gửi nhà cung cấp, ghi lượt không lưu nội dung', async () => {
    const result = await complete(userOf('a'), 99_999);
    assert.deepEqual(result, {
      text: 'Đây là bộ lọc',
      toolCalls: [{ id: 'tu_1', name: 'search_filter', input: { bedroomsMin: 3 } }],
      stopReason: 'tool_use',
      usage: { inputTokens: 50, outputTokens: 12 },
    });

    assert.equal(llm.calls.length, 1);
    assert.equal(llm.calls[0]?.headers['x-api-key'], API_KEY);
    assert.equal(llm.calls[0]?.body['model'], 'claude-test');
    assert.equal(llm.calls[0]?.body['max_tokens'], 8192);
    assert.deepEqual(llm.calls[0]?.body['tool_choice'], { type: 'tool', name: 'search_filter' });

    assert.deepEqual(await rows(), [
      {
        tenant_id: userOf('a').tenantId,
        user_id: userOf('a').userId,
        feature: 'search',
        provider: 'anthropic',
        model: 'claude-test',
        status: 'SUCCESS',
        input_tokens: 50,
        output_tokens: 12,
        tool_names: ['search_filter'],
        error_code: null,
      },
    ]);
    const stored = JSON.stringify(await db.query('SELECT * FROM ai_requests'));
    assert.ok(!stored.includes('0901234567'));
    assert.ok(!stored.includes(API_KEY));
  });

  it('nhà cung cấp lỗi: trả 503 hoặc 429 chung chung và ghi lượt lỗi', async () => {
    llm.reply = { status: 500, body: { error: { message: 'lỗi nội bộ' } } };
    await assert.rejects(complete(userOf('a')), isAppError(ErrorCode.SERVICE_UNAVAILABLE, 503));
    llm.reply = { status: 401, body: { error: { message: 'invalid x-api-key' } } };
    await assert.rejects(complete(userOf('a')), isAppError(ErrorCode.SERVICE_UNAVAILABLE, 503));
    llm.reply = { status: 429, body: { error: { message: 'rate limit' } } };
    await assert.rejects(complete(userOf('a')), isAppError(ErrorCode.RATE_LIMITED, 429));

    assert.deepEqual(
      (await rows()).map((row) => [row.status, row.error_code, row.input_tokens, row.tool_names]),
      [
        ['ERROR', 'UNAVAILABLE', null, []],
        ['ERROR', 'AUTH_FAILED', null, []],
        ['ERROR', 'RATE_LIMITED', null, []],
      ],
    );
  });

  it('hết lượt trong 24 giờ thì chặn trước khi gọi LLM; người khác không bị ảnh hưởng', async () => {
    for (let i = 0; i < DAILY_LIMIT; i += 1) {
      await complete(userOf('a'));
    }
    assert.equal(llm.calls.length, DAILY_LIMIT);
    await assert.rejects(complete(userOf('a')), isAppError(ErrorCode.RATE_LIMITED, 429));
    assert.equal(llm.calls.length, DAILY_LIMIT);
    assert.deepEqual(await status('a'), {
      enabled: true,
      dailyLimit: DAILY_LIMIT,
      used: DAILY_LIMIT,
      remaining: 0,
    });

    await complete(userOf('b'));
    assert.equal((await status('b'))['used'], 1);

    // Lượt cũ hơn 24 giờ không tính.
    await db.query(
      `UPDATE ai_requests SET created_at = now() - interval '25 hours' WHERE user_id = $1`,
      [userOf('a').userId],
    );
    assert.equal((await status('a'))['remaining'], DAILY_LIMIT);
    await complete(userOf('a'));
  });

  it('tên tính năng sai là lỗi lập trình, không gọi LLM', async () => {
    await assert.rejects(
      gateway.complete(userOf('a'), {
        feature: 'AI.Search',
        messages: [{ role: 'user', content: 'x' }],
      }),
      /Tên tính năng AI không hợp lệ/,
    );
    assert.equal(llm.calls.length, 0);
  });

  it('chưa cấu hình AI_API_KEY: tắt AI, gọi thì trả 503', async () => {
    const disabled = new AiGatewayService(null, { ai: null } as AppConfig, db);
    assert.equal(disabled.enabled, false);
    assert.deepEqual(await disabled.status(userOf('a')), {
      enabled: false,
      dailyLimit: null,
      used: 0,
      remaining: null,
    });
    await assert.rejects(
      disabled.complete(userOf('a'), { feature: 'search', messages: [] }),
      isAppError(ErrorCode.SERVICE_UNAVAILABLE, 503),
    );
    assert.equal(llm.calls.length, 0);
  });
});
