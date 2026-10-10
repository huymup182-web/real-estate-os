import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { AuthenticatedUser } from '../auth/access-token.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { getRequestContext } from '../common/logging/request-context.js';
import { APP_CONFIG } from '../config/app-config.module.js';
import type { AppConfig } from '../config/app-config.js';
import {
  LlmError,
  type LlmErrorCode,
  LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from './llm-provider.js';

/** Token inject adapter LLM; `null` khi chưa cấu hình AI_API_KEY. */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

const DEFAULT_MAX_TOKENS = 1024;
const MAX_TOKENS_LIMIT = 8192;
const FEATURE_PATTERN = /^[a-z][a-z_]*$/;

/** Một lời gọi AI của một tính năng, vd `feature: 'search'` cho tìm kiếm bằng ngôn ngữ tự nhiên. */
export interface AiCompletionRequest extends Omit<LlmRequest, 'maxTokens'> {
  /** Tên tính năng gọi AI (chữ thường, `_`), ghi vào `ai_requests.feature`. */
  feature: string;
  /** Mặc định 1024, tối đa 8192. */
  maxTokens?: number;
}

export interface AiStatus {
  enabled: boolean;
  /** Số lượt tối đa trong 24 giờ; null khi AI tắt. */
  dailyLimit: number | null;
  /** Số lượt đã dùng trong 24 giờ gần nhất. */
  used: number;
  remaining: number | null;
}

/**
 * AI gateway (TASK-133): mọi lời gọi AI đi Mobile → Backend → AiGatewayService → LLM. Kiểm giới hạn lượt
 * của từng người, gọi adapter LLM và ghi mỗi lượt vào `ai_requests` (user, tenant, tính năng, tool LLM
 * đã gọi, số token; không lưu nội dung). Lỗi của nhà cung cấp không bao giờ trả nguyên văn cho client.
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);

  constructor(
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider | null,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly dataSource: DataSource,
  ) {}

  get enabled(): boolean {
    return this.provider !== null;
  }

  async status(user: AuthenticatedUser): Promise<AiStatus> {
    const used = await this.usedToday(user);
    const dailyLimit = this.provider && this.config.ai ? this.config.ai.userDailyLimit : null;
    return {
      enabled: dailyLimit !== null,
      dailyLimit,
      used,
      remaining: dailyLimit === null ? null : Math.max(dailyLimit - used, 0),
    };
  }

  async complete(user: AuthenticatedUser, request: AiCompletionRequest): Promise<LlmResponse> {
    const { provider } = this;
    if (!provider || !this.config.ai) {
      throw new AppException(ErrorCode.SERVICE_UNAVAILABLE, 'Tính năng AI chưa được bật');
    }
    if (!FEATURE_PATTERN.test(request.feature)) {
      throw new Error(`Tên tính năng AI không hợp lệ: "${request.feature}"`);
    }
    const { feature, maxTokens, ...rest } = request;

    const limit = this.config.ai.userDailyLimit;
    if ((await this.usedToday(user)) >= limit) {
      throw new AppException(
        ErrorCode.RATE_LIMITED,
        `Bạn đã dùng hết ${limit} lượt AI trong 24 giờ, vui lòng thử lại sau`,
      );
    }

    const startedAt = Date.now();
    let response: LlmResponse;
    try {
      response = await provider.complete({
        ...rest,
        maxTokens: Math.min(Math.max(maxTokens ?? DEFAULT_MAX_TOKENS, 1), MAX_TOKENS_LIMIT),
      });
    } catch (error) {
      const code: LlmErrorCode | 'INTERNAL' = error instanceof LlmError ? error.code : 'INTERNAL';
      this.logger.warn(`Gọi AI lỗi ${code}`, {
        feature,
        provider: provider.name,
        message: error instanceof Error ? error.message : String(error),
      });
      await this.record(user, feature, provider, startedAt, { errorCode: code });
      throw code === 'RATE_LIMITED'
        ? new AppException(ErrorCode.RATE_LIMITED, 'AI đang quá tải, vui lòng thử lại sau')
        : new AppException(
            ErrorCode.SERVICE_UNAVAILABLE,
            'Không gọi được AI, vui lòng thử lại sau',
          );
    }

    await this.record(user, feature, provider, startedAt, { response });
    return response;
  }

  /** Lượt gọi AI (kể cả lỗi) của user trong 24 giờ gần nhất. */
  private async usedToday(user: AuthenticatedUser): Promise<number> {
    const [row] = (await this.dataSource.query(
      `SELECT count(*)::int AS count FROM ai_requests
        WHERE user_id = $1 AND created_at > now() - interval '24 hours'`,
      [user.userId],
    )) as { count: number }[];
    return row?.count ?? 0;
  }

  private async record(
    user: AuthenticatedUser,
    feature: string,
    provider: LlmProvider,
    startedAt: number,
    outcome: { response: LlmResponse } | { errorCode: string },
  ): Promise<void> {
    const response = 'response' in outcome ? outcome.response : null;
    await this.dataSource.query(
      `INSERT INTO ai_requests
         (tenant_id, user_id, feature, provider, model, status, input_tokens, output_tokens,
          tool_names, error_code, latency_ms, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        user.tenantId,
        user.userId,
        feature,
        provider.name,
        provider.model,
        response ? 'SUCCESS' : 'ERROR',
        response?.usage.inputTokens ?? null,
        response?.usage.outputTokens ?? null,
        response?.toolCalls.map((call) => call.name) ?? [],
        'errorCode' in outcome ? outcome.errorCode : null,
        Math.max(Date.now() - startedAt, 0),
        getRequestContext()?.requestId ?? null,
      ],
    );
  }
}
