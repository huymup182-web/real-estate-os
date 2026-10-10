import type { AiConfig } from '../config/app-config.js';
import {
  LlmError,
  LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type LlmStopReason,
  type LlmToolCall,
} from './llm-provider.js';

/** Phiên bản Messages API (https://docs.anthropic.com/en/api/versioning). */
const ANTHROPIC_VERSION = '2023-06-01';

const STOP_REASONS: Readonly<Record<string, LlmStopReason>> = {
  end_turn: 'end',
  stop_sequence: 'end',
  tool_use: 'tool_use',
  max_tokens: 'max_tokens',
  refusal: 'refusal',
};

export interface AnthropicProviderOptions {
  fetch?: typeof fetch;
}

interface ContentBlock {
  type?: unknown;
  text?: unknown;
  id?: unknown;
  name?: unknown;
  input?: unknown;
}

/**
 * Gọi Claude qua Anthropic Messages API trực tiếp bằng `fetch` (TASK-133), không cần SDK.
 * API key chỉ nằm ở backend (biến AI_API_KEY), không bao giờ gửi cho mobile/admin hay ghi log.
 */
export class AnthropicProvider extends LlmProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly fetch: typeof fetch;

  constructor(
    private readonly config: AiConfig,
    options: AnthropicProviderOptions = {},
  ) {
    super();
    this.model = config.model;
    this.fetch = options.fetch ?? fetch;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: request.maxTokens,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (request.system) {
      body['system'] = request.system;
    }
    if (request.tools?.length) {
      body['tools'] = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
      if (request.forceTool) {
        body['tool_choice'] = { type: 'tool', name: request.forceTool };
      }
    }

    let response: Response;
    try {
      response = await this.fetch(`${this.config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.config.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new LlmError('TIMEOUT', `Anthropic không trả lời sau ${this.config.timeoutMs} ms`);
      }
      throw new LlmError('NETWORK', 'Không kết nối được Anthropic');
    }

    if (!response.ok) {
      throw new LlmError(errorCodeFor(response.status), `Anthropic trả lỗi ${response.status}`);
    }
    return parseResponse(await readJson(response));
  }
}

function errorCodeFor(status: number): LlmError['code'] {
  if (status === 401 || status === 403) {
    return 'AUTH_FAILED';
  }
  if (status === 429) {
    return 'RATE_LIMITED';
  }
  if (status >= 500) {
    // 529: Anthropic đang quá tải.
    return 'UNAVAILABLE';
  }
  return 'BAD_REQUEST';
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new LlmError('BAD_RESPONSE', 'Phản hồi Anthropic không phải JSON');
  }
}

function parseResponse(json: unknown): LlmResponse {
  const body = (typeof json === 'object' && json !== null ? json : {}) as {
    content?: unknown;
    stop_reason?: unknown;
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
  };
  if (!Array.isArray(body.content)) {
    throw new LlmError('BAD_RESPONSE', 'Phản hồi Anthropic thiếu content');
  }

  const texts: string[] = [];
  const toolCalls: LlmToolCall[] = [];
  for (const block of body.content as ContentBlock[]) {
    if (block.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text);
    } else if (
      block.type === 'tool_use' &&
      typeof block.id === 'string' &&
      typeof block.name === 'string' &&
      typeof block.input === 'object' &&
      block.input !== null &&
      !Array.isArray(block.input)
    ) {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      });
    }
  }

  const stopReason =
    typeof body.stop_reason === 'string' ? (STOP_REASONS[body.stop_reason] ?? 'other') : 'other';
  return {
    text: texts.join(''),
    toolCalls,
    stopReason,
    usage: {
      inputTokens: tokenCount(body.usage?.input_tokens),
      outputTokens: tokenCount(body.usage?.output_tokens),
    },
  };
}

function tokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}
