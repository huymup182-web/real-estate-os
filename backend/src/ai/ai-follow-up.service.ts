import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/access-token.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { FOLLOW_UP_AFTER_DAYS } from '../customers/customer-values.js';
import {
  type CustomerScopes,
  CustomersService,
  type FollowUpCandidate,
} from '../customers/customers.service.js';
import type { Actor } from '../properties/properties.service.js';
import { AiGatewayService } from './ai-gateway.service.js';
import {
  ACTIVITY_TYPE_LABELS,
  CUSTOMER_PURPOSE_LABELS,
  CUSTOMER_STATUS_LABELS,
  labelOf,
  PURCHASE_TIMELINE_LABELS,
} from './customer-facts.js';
import {
  FOLLOW_UP_ACTIONS,
  FOLLOW_UP_LIMIT,
  FOLLOW_UP_SYSTEM_PROMPT,
  FOLLOW_UP_TOOL,
  type FollowUpAction,
  followUpTool,
} from './follow-up.tool.js';
import { hidePhones } from './redact.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TEXT_LENGTH = 500;
/** Độ dài tối đa nội dung hoạt động gần nhất gửi LLM. */
const MAX_FACT_LENGTH = 300;

export interface FollowUpSuggestion {
  action: FollowUpAction;
  reason: string;
  message: string;
}

export interface FollowUpItem {
  customer: { id: string; fullName: string; status: string; agentId: string | null };
  lastContactAt: Date;
  daysSinceContact: number;
  /** null khi AI không gợi ý được cho khách này. */
  suggestion: FollowUpSuggestion | null;
}

export interface AiFollowUps {
  /** Số ngày không chăm sóc thì tính là cần chăm sóc. */
  thresholdDays: number;
  items: FollowUpItem[];
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? hidePhones(value).trim().slice(0, MAX_TEXT_LENGTH) : '';
}

function isAction(value: unknown): value is FollowUpAction {
  return FOLLOW_UP_ACTIONS.includes(value as FollowUpAction);
}

/**
 * Gợi ý chăm sóc khách (TASK-141, MASTER_PLAN mục 20 "Khách nào cần follow-up hôm nay?"). Luật chọn khách
 * (`CustomersService.followUps`), AI chỉ gợi ý việc làm và câu nhắn. Không gửi LLM tên, liên hệ của khách.
 * Không có khách nào cần chăm sóc thì không gọi AI (không tốn lượt).
 */
@Injectable()
export class AiFollowUpService {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly customers: CustomersService,
  ) {}

  async suggest(
    user: AuthenticatedUser,
    actor: Actor,
    scopes: CustomerScopes,
  ): Promise<AiFollowUps> {
    const { candidates, facts } = await this.candidates(actor, scopes);
    if (candidates.length === 0) {
      return { thresholdDays: FOLLOW_UP_AFTER_DAYS, items: [] };
    }

    const response = await this.gateway.complete(user, {
      feature: 'follow_up',
      system: FOLLOW_UP_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(facts) }],
      tools: [followUpTool],
      forceTool: FOLLOW_UP_TOOL,
      maxTokens: 2048,
    });
    const input = response.toolCalls.find((call) => call.name === FOLLOW_UP_TOOL)?.input;
    const raw = input?.['suggestions'];
    if (!Array.isArray(raw)) {
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'AI chưa gợi ý được việc chăm sóc, vui lòng thử lại',
      );
    }

    // Mã lạ, việc lạ, thiếu câu thì bỏ; khách có nhiều gợi ý thì lấy gợi ý đầu.
    const byRef = new Map<string, FollowUpSuggestion>();
    for (const item of raw as Record<string, unknown>[]) {
      const ref = typeof item['ref'] === 'string' ? item['ref'].trim().toUpperCase() : '';
      const reason = cleanText(item['reason']);
      const message = cleanText(item['message']);
      if (isAction(item['action']) && reason !== '' && message !== '' && !byRef.has(ref)) {
        byRef.set(ref, { action: item['action'], reason, message });
      }
    }

    return {
      thresholdDays: FOLLOW_UP_AFTER_DAYS,
      items: candidates.map((candidate, index) => ({
        customer: {
          id: candidate.id,
          fullName: candidate.fullName,
          status: candidate.status,
          agentId: candidate.agentId,
        },
        lastContactAt: candidate.lastContactAt,
        daysSinceContact: candidate.daysSinceContact,
        suggestion: byRef.get(`K${String(index + 1)}`) ?? null,
      })),
    };
  }

  /**
   * Khách cần chăm sóc (tối đa `FOLLOW_UP_LIMIT`) và dữ liệu gửi LLM, khách thứ n có mã `Kn`; không có tên,
   * liên hệ. Dùng chung với Copilot (TASK-143).
   */
  async candidates(
    actor: Actor,
    scopes: CustomerScopes,
  ): Promise<{
    candidates: (FollowUpCandidate & { daysSinceContact: number })[];
    facts: Record<string, unknown>[];
  }> {
    const now = Date.now();
    const candidates = (await this.customers.followUps(actor, scopes, FOLLOW_UP_LIMIT)).map(
      (candidate) => ({
        ...candidate,
        daysSinceContact: Math.floor((now - candidate.lastContactAt.getTime()) / DAY_MS),
      }),
    );
    const facts = candidates.map((candidate, index) => ({
      ma: `K${String(index + 1)}`,
      buoc: labelOf(CUSTOMER_STATUS_LABELS, candidate.status),
      muc_dich: labelOf(CUSTOMER_PURPOSE_LABELS, candidate.purpose),
      thoi_gian_mua: labelOf(PURCHASE_TIMELINE_LABELS, candidate.purchaseTimeline),
      so_ngay_chua_cham_soc: candidate.daysSinceContact,
      so_nhu_cau_dang_bat: candidate.activeNeeds,
      hoat_dong_gan_nhat: candidate.lastActivity
        ? {
            loai: labelOf(ACTIVITY_TYPE_LABELS, candidate.lastActivity.type),
            noi_dung: candidate.lastActivity.content
              ? hidePhones(candidate.lastActivity.content).slice(0, MAX_FACT_LENGTH)
              : null,
          }
        : null,
    }));
    return { candidates, facts };
  }
}
