import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AI_TIMEOUT_MS, assistDeal, getAiStatus } from './ai.ts';
import { BACKEND_TIMEOUT_MS } from './backend.ts';

const env = { API_INTERNAL_URL: 'http://backend:3000' };

/** fetch giả: ghi lại yêu cầu, trả `body` với mã `status`. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('API AI', () => {
  it('trợ lý bán hàng: POST /deals/:id/ai-assistant kèm token, chờ lâu hơn lệnh thường', async () => {
    const data = {
      dealId: 'd1',
      situation: 'Đang thương lượng.',
      nextSteps: ['Hẹn gặp'],
      talkingPoints: [],
      risks: [],
    };
    const { calls, fetchImpl } = fakeFetch(200, { success: true, data });
    const result = await assistDeal('tok', 'd 1', { fetchImpl, env });
    assert.deepEqual(result, { ok: true, status: 200, data });
    assert.equal(calls[0]?.url, 'http://backend:3000/api/v1/deals/d%201/ai-assistant');
    assert.equal(calls[0]?.init.method, 'POST');
    assert.equal((calls[0]?.init.headers as Record<string, string>)['authorization'], 'Bearer tok');
    assert.ok(AI_TIMEOUT_MS > BACKEND_TIMEOUT_MS);
  });

  it('lỗi AI giữ mã và câu báo của backend', async () => {
    const { fetchImpl } = fakeFetch(503, {
      success: false,
      message: 'Tính năng AI chưa được bật',
      error: { code: 'SERVICE_UNAVAILABLE' },
    });
    assert.deepEqual(await assistDeal('tok', 'd1', { fetchImpl, env }), {
      ok: false,
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Tính năng AI chưa được bật',
    });
  });

  it('trạng thái AI: GET /ai/status', async () => {
    const data = { enabled: true, dailyLimit: 100, used: 3, remaining: 97 };
    const { calls, fetchImpl } = fakeFetch(200, { success: true, data });
    assert.deepEqual(await getAiStatus('tok', { fetchImpl, env }), { ok: true, status: 200, data });
    assert.equal(calls[0]?.url, 'http://backend:3000/api/v1/ai/status');
  });
});
