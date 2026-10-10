import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AnthropicProvider } from '../src/ai/anthropic.provider.js';
import { LlmError } from '../src/ai/llm-provider.js';
import type { AiConfig } from '../src/config/app-config.js';

const CONFIG: AiConfig = {
  provider: 'anthropic',
  apiKey: 'sk-ant-bi-mat',
  model: 'claude-test',
  baseUrl: 'http://llm.test',
  timeoutMs: 5000,
  userDailyLimit: 10,
};

interface Captured {
  url: string;
  init: RequestInit;
}

function providerReturning(
  respond: () => Response | Promise<Response>,
  config: AiConfig = CONFIG,
): { provider: AnthropicProvider; calls: Captured[] } {
  const calls: Captured[] = [];
  const fakeFetch = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(respond());
  }) as typeof fetch;
  return { provider: new AnthropicProvider(config, { fetch: fakeFetch }), calls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const OK_BODY = {
  content: [
    { type: 'text', text: 'Tìm thấy ' },
    { type: 'text', text: 'nhà phù hợp' },
    { type: 'tool_use', id: 'tu_1', name: 'search_properties', input: { priceMax: 5e9 } },
  ],
  stop_reason: 'tool_use',
  usage: { input_tokens: 120, output_tokens: 30 },
};

describe('AnthropicProvider (TASK-133)', () => {
  it('gửi đúng Messages API: API key ở header, tool, tool bắt buộc', async () => {
    const { provider, calls } = providerReturning(() => json(200, OK_BODY));
    await provider.complete({
      system: 'Bạn là trợ lý BĐS',
      messages: [{ role: 'user', content: 'nhà dưới 5 tỷ' }],
      tools: [
        {
          name: 'search_properties',
          description: 'Tìm BĐS',
          inputSchema: { type: 'object', properties: { priceMax: { type: 'number' } } },
        },
      ],
      forceTool: 'search_properties',
      maxTokens: 256,
    });

    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.equal(call?.url, 'http://llm.test/v1/messages');
    assert.equal(call?.init.method, 'POST');
    const headers = call?.init.headers as Record<string, string>;
    assert.equal(headers['x-api-key'], 'sk-ant-bi-mat');
    assert.equal(headers['anthropic-version'], '2023-06-01');
    assert.ok(call?.init.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(String(call?.init.body)), {
      model: 'claude-test',
      max_tokens: 256,
      system: 'Bạn là trợ lý BĐS',
      messages: [{ role: 'user', content: 'nhà dưới 5 tỷ' }],
      tools: [
        {
          name: 'search_properties',
          description: 'Tìm BĐS',
          input_schema: { type: 'object', properties: { priceMax: { type: 'number' } } },
        },
      ],
      tool_choice: { type: 'tool', name: 'search_properties' },
    });
  });

  it('không có tool thì không gửi tools/tool_choice; không có system thì bỏ system', async () => {
    const { provider, calls } = providerReturning(() => json(200, OK_BODY));
    await provider.complete({
      messages: [{ role: 'user', content: 'xin chào' }],
      forceTool: 'bo_qua',
      maxTokens: 10,
    });
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
      model: 'claude-test',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'xin chào' }],
    });
  });

  it('hội thoại nhiều bước: tool_use, tool_result dạng khối; noToolCalls → tool_choice none (TASK-143)', async () => {
    const { provider, calls } = providerReturning(() => json(200, OK_BODY));
    await provider.complete({
      messages: [
        { role: 'user', content: 'nhà dưới 5 tỷ' },
        {
          role: 'assistant',
          content: 'Để em tìm.',
          toolCalls: [{ id: 'tu_1', name: 'search_properties', input: { priceMax: 5e9 } }],
        },
        {
          role: 'user',
          content: '',
          toolResults: [
            { toolCallId: 'tu_1', content: '[]' },
            { toolCallId: 'tu_2', content: 'Không tìm thấy', isError: true },
          ],
        },
      ],
      tools: [{ name: 'search_properties', description: 'Tìm BĐS', inputSchema: {} }],
      forceTool: 'search_properties',
      noToolCalls: true,
      maxTokens: 10,
    });
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    assert.deepEqual(body['messages'], [
      { role: 'user', content: 'nhà dưới 5 tỷ' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Để em tìm.' },
          { type: 'tool_use', id: 'tu_1', name: 'search_properties', input: { priceMax: 5e9 } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_1', content: '[]' },
          { type: 'tool_result', tool_use_id: 'tu_2', content: 'Không tìm thấy', is_error: true },
        ],
      },
    ]);
    assert.deepEqual(body['tool_choice'], { type: 'none' });
  });

  it('đọc chữ, tool call, lý do dừng, số token', async () => {
    const { provider } = providerReturning(() => json(200, OK_BODY));
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'x' }],
      maxTokens: 10,
    });
    assert.deepEqual(result, {
      text: 'Tìm thấy nhà phù hợp',
      toolCalls: [{ id: 'tu_1', name: 'search_properties', input: { priceMax: 5e9 } }],
      stopReason: 'tool_use',
      usage: { inputTokens: 120, outputTokens: 30 },
    });
  });

  it('bỏ khối lạ, lý do dừng lạ thành other, thiếu usage thành 0', async () => {
    const { provider } = providerReturning(() =>
      json(200, {
        content: [
          { type: 'thinking', thinking: '...' },
          { type: 'tool_use', id: 'tu_2', name: 'x', input: ['mảng'] },
          { type: 'text', text: 'ok' },
        ],
        stop_reason: 'pause_turn',
      }),
    );
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'x' }],
      maxTokens: 10,
    });
    assert.deepEqual(result, {
      text: 'ok',
      toolCalls: [],
      stopReason: 'other',
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  });

  it('đổi lỗi HTTP thành mã lỗi; câu lỗi không chứa API key', async () => {
    const cases: [number, string][] = [
      [401, 'AUTH_FAILED'],
      [403, 'AUTH_FAILED'],
      [429, 'RATE_LIMITED'],
      [500, 'UNAVAILABLE'],
      [529, 'UNAVAILABLE'],
      [400, 'BAD_REQUEST'],
    ];
    for (const [status, code] of cases) {
      const { provider } = providerReturning(() =>
        json(status, { error: { message: `lỗi có ${CONFIG.apiKey}` } }),
      );
      await assert.rejects(
        provider.complete({ messages: [{ role: 'user', content: 'x' }], maxTokens: 10 }),
        (error: unknown) => {
          assert.ok(error instanceof LlmError);
          assert.equal(error.code, code, String(status));
          assert.ok(!error.message.includes(CONFIG.apiKey));
          return true;
        },
      );
    }
  });

  it('phản hồi hỏng thành BAD_RESPONSE', async () => {
    for (const response of [
      () => new Response('khong-phai-json', { status: 200 }),
      () => json(200, { content: 'chuỗi' }),
      () => json(200, null),
    ]) {
      const { provider } = providerReturning(response);
      await assert.rejects(
        provider.complete({ messages: [{ role: 'user', content: 'x' }], maxTokens: 10 }),
        (error: unknown) => error instanceof LlmError && error.code === 'BAD_RESPONSE',
      );
    }
  });

  it('lỗi mạng thành NETWORK, quá thời gian thành TIMEOUT', async () => {
    const { provider: network } = providerReturning(() => {
      throw new TypeError('fetch failed');
    });
    await assert.rejects(
      network.complete({ messages: [{ role: 'user', content: 'x' }], maxTokens: 10 }),
      (error: unknown) => error instanceof LlmError && error.code === 'NETWORK',
    );

    // fetch hủy theo AbortSignal.timeout thì ném DOMException tên TimeoutError.
    const { provider: slow } = providerReturning(() => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    await assert.rejects(
      slow.complete({ messages: [{ role: 'user', content: 'x' }], maxTokens: 10 }),
      (error: unknown) => error instanceof LlmError && error.code === 'TIMEOUT',
    );
  });
});
