import { type BackendDeps, callBackend } from './backend.ts';

/**
 * Thời gian chờ khi gọi API AI: backend chờ LLM tối đa `AI_TIMEOUT_MS` (mặc định 60 giây, xem
 * backend/README.md), cộng thêm một chút cho backend.
 */
export const AI_TIMEOUT_MS = 65_000;

/** Trạng thái AI của người đang đăng nhập (`GET /ai/status`, TASK-133). */
export interface AiStatus {
  enabled: boolean;
  dailyLimit: number | null;
  used: number;
  remaining: number | null;
}

/** Gợi ý chốt giao dịch (`POST /deals/:id/ai-assistant`, TASK-142). */
export interface AiSalesAssist {
  dealId: string;
  situation: string;
  nextSteps: string[];
  talkingPoints: string[];
  risks: string[];
}

export function getAiStatus(token: string, deps?: BackendDeps) {
  return callBackend<AiStatus>('/ai/status', { accessToken: token }, deps);
}

/** Trợ lý bán hàng cho giao dịch `id` (cần `deal.view`). Mỗi lần gọi tính một lượt AI. */
export function assistDeal(token: string, id: string, deps?: BackendDeps) {
  return callBackend<AiSalesAssist>(
    `/deals/${encodeURIComponent(id)}/ai-assistant`,
    { method: 'POST', accessToken: token, timeoutMs: AI_TIMEOUT_MS },
    deps,
  );
}
