import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { AuthenticatedUser } from '../auth/access-token.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { PaginationQueryDto } from '../common/response/pagination-query.dto.js';
import { CustomerActivitiesService } from '../customers/customer-activities.service.js';
import { CustomerPreferencesService } from '../customers/customer-preferences.service.js';
import { type CustomerScopes, CustomersService } from '../customers/customers.service.js';
import { DISPLAY_TIME_ZONE } from '../notifications/notification-values.js';
import type { Actor } from '../properties/properties.service.js';
import { AiGatewayService } from './ai-gateway.service.js';
import {
  ACTIVITY_TYPE_LABELS,
  CUSTOMER_PURPOSE_LABELS,
  CUSTOMER_SOURCE_LABELS,
  CUSTOMER_STATUS_LABELS,
  labelOf,
  preferenceFacts,
  PURCHASE_TIMELINE_LABELS,
} from './customer-facts.js';
import {
  CUSTOMER_SUMMARY_SYSTEM_PROMPT,
  CUSTOMER_SUMMARY_TOOL,
  customerSummaryTool,
  MAX_KEY_POINTS,
  MAX_OPEN_QUESTIONS,
  SUMMARY_ACTIVITY_LIMIT,
} from './customer-summary.tool.js';
import { hidePhones } from './redact.js';

const MAX_TEXT_LENGTH = 500;
/** Độ dài tối đa của ghi chú, nội dung hoạt động gửi LLM. */
const MAX_FACT_LENGTH = 1000;

/** Tóm tắt khách AI viết (TASK-140). */
export interface AiCustomerSummary {
  customerId: string;
  summary: string;
  keyPoints: string[];
  openQuestions: string[];
  /** Số hoạt động đã gửi AI (tối đa `SUMMARY_ACTIVITY_LIMIT` hoạt động gần nhất). */
  activityCount: number;
}

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TIME_ZONE, dateStyle: 'short' });
const TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
});

/** Ngày giờ theo giờ Việt Nam: "2026-10-10 09:30". */
function at(date: Date): string {
  return `${DAY.format(date)} ${TIME.format(date)}`;
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? hidePhones(value).trim().slice(0, MAX_TEXT_LENGTH) : '';
}

function cleanList(value: unknown, max: number): string[] {
  return Array.isArray(value)
    ? value
        .map(cleanText)
        .filter((item) => item !== '')
        .slice(0, max)
    : [];
}

function fact(value: string | null): string | null {
  return value ? hidePhones(value).slice(0, MAX_FACT_LENGTH) : null;
}

/**
 * AI tóm tắt nhu cầu và lịch sử chăm sóc khách (TASK-140, MASTER_PLAN mục 20 "Tóm tắt lịch sử khách này").
 * Không gửi LLM tên, số điện thoại, email của khách hay tên người chăm sóc; số điện thoại trong ghi chú bị ẩn.
 */
@Injectable()
export class AiCustomerSummaryService {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly customers: CustomersService,
    private readonly preferences: CustomerPreferencesService,
    private readonly activities: CustomerActivitiesService,
    private readonly dataSource: DataSource,
  ) {}

  async summarize(
    user: AuthenticatedUser,
    actor: Actor,
    customerId: string,
    scopes: CustomerScopes,
  ): Promise<AiCustomerSummary> {
    const { facts, activityCount } = await this.facts(actor, customerId, scopes);

    const response = await this.gateway.complete(user, {
      feature: 'customer_summary',
      system: CUSTOMER_SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(facts) }],
      tools: [customerSummaryTool],
      forceTool: CUSTOMER_SUMMARY_TOOL,
      maxTokens: 1024,
    });
    const input = response.toolCalls.find((call) => call.name === CUSTOMER_SUMMARY_TOOL)?.input;
    const summary = cleanText(input?.['summary']);
    if (!input || summary === '') {
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'AI chưa tóm tắt được khách, vui lòng thử lại',
      );
    }
    return {
      customerId,
      summary,
      keyPoints: cleanList(input['keyPoints'], MAX_KEY_POINTS),
      openQuestions: cleanList(input['openQuestions'], MAX_OPEN_QUESTIONS),
      activityCount,
    };
  }

  /**
   * Dữ liệu khách gửi LLM: khách ngoài phạm vi `customer.view` → 404. Dùng chung với Copilot (TASK-143).
   */
  async facts(
    actor: Actor,
    customerId: string,
    scopes: CustomerScopes,
  ): Promise<{ facts: Record<string, unknown>; activityCount: number }> {
    const customer = await this.customers.findOne(actor, customerId, scopes);
    const preferences = await this.preferences.findAll(actor, customerId, scopes);
    const query = Object.assign(new PaginationQueryDto(), { pageSize: SUMMARY_ACTIVITY_LIMIT });
    const activities = (await this.activities.findAll(actor, customerId, query, scopes)).items;

    const facts = {
      hom_nay: DAY.format(new Date()),
      khach_hang: {
        buoc: labelOf(CUSTOMER_STATUS_LABELS, customer.status),
        muc_dich: labelOf(CUSTOMER_PURPOSE_LABELS, customer.purpose),
        thoi_gian_mua: labelOf(PURCHASE_TIMELINE_LABELS, customer.purchaseTimeline),
        nguon: labelOf(CUSTOMER_SOURCE_LABELS, customer.source),
        ly_do_mat_khach: fact(customer.lostReason),
        ghi_chu: fact(customer.notes),
        ngay_tao: DAY.format(customer.createdAt),
        da_giao_moi_gioi: customer.agentId !== null,
      },
      nhu_cau: await preferenceFacts(this.dataSource, preferences),
      // Cũ trước, mới sau, để đọc như một câu chuyện.
      hoat_dong: [...activities].reverse().map((activity) => {
        const from = activity.metadata['fromStatus'];
        const to = activity.metadata['toStatus'];
        return {
          luc: at(activity.occurredAt),
          loai: labelOf(ACTIVITY_TYPE_LABELS, activity.type),
          noi_dung: fact(activity.content),
          ...(typeof from === 'string' && typeof to === 'string'
            ? {
                doi_buoc: `${labelOf(CUSTOMER_STATUS_LABELS, from)} → ${labelOf(CUSTOMER_STATUS_LABELS, to)}`,
              }
            : {}),
          ...(activity.propertyIds?.length ? { so_bds_gui_kem: activity.propertyIds.length } : {}),
        };
      }),
    };

    return { facts, activityCount: activities.length };
  }
}
