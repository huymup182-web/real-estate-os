/** Một lượt hội thoại gửi LLM. */
export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Tool LLM đã gọi ở lượt `assistant` này (Copilot gọi tool nhiều bước, TASK-143). */
  toolCalls?: LlmToolCall[];
  /** Kết quả các tool backend đã chạy, gửi lại LLM ở lượt `user` (TASK-143). */
  toolResults?: LlmToolResult[];
}

/** Kết quả một tool backend đã chạy cho LLM. */
export interface LlmToolResult {
  /** `LlmToolCall.id` của lời gọi tool. */
  toolCallId: string;
  /** Dữ liệu trả LLM, thường là JSON. */
  content: string;
  /** Tool chạy lỗi (vd không tìm thấy, sai tham số): `content` là câu lỗi. */
  isError?: boolean;
}

/**
 * Tool LLM được phép gọi. Backend tự chạy tool qua service layer với quyền + tenant của user
 * (phase0/02-ARCHITECTURE.md mục 8); LLM chỉ đề xuất tên tool và tham số.
 */
export interface LlmTool {
  name: string;
  description: string;
  /** JSON Schema của tham số tool. */
  inputSchema: Record<string, unknown>;
}

export interface LlmRequest {
  system?: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
  /** Tên tool LLM bắt buộc phải gọi (lấy kết quả có cấu trúc); bỏ trống thì LLM tự chọn. */
  forceTool?: string;
  /** Gửi kèm `tools` (bắt buộc khi hội thoại có tool) nhưng không cho LLM gọi tool nữa, phải trả lời chữ. */
  noToolCalls?: boolean;
  maxTokens: number;
}

export interface LlmToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type LlmStopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export interface LlmResponse {
  /** Phần chữ LLM trả lời (nối các đoạn text). */
  text: string;
  toolCalls: LlmToolCall[];
  stopReason: LlmStopReason;
  usage: { inputTokens: number; outputTokens: number };
}

/** Mã lỗi gọi LLM, ghi vào `ai_requests.error_code`. */
export type LlmErrorCode =
  | 'TIMEOUT'
  | 'NETWORK'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'AUTH_FAILED'
  | 'BAD_REQUEST'
  | 'BAD_RESPONSE';

/** Lỗi khi gọi nhà cung cấp LLM. Câu lỗi không bao giờ chứa API key hay nội dung prompt. */
export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** Adapter của một nhà cung cấp LLM (TASK-133). Đổi nhà cung cấp = viết adapter khác. */
export abstract class LlmProvider {
  abstract readonly name: string;
  abstract readonly model: string;
  /** Ném `LlmError` khi gọi không thành công. */
  abstract complete(request: LlmRequest): Promise<LlmResponse>;
}
