import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { AuthenticatedUser } from '../auth/access-token.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { PaginationQueryDto } from '../common/response/pagination-query.dto.js';
import { CustomerActivitiesService } from '../customers/customer-activities.service.js';
import { CustomerPreferencesService } from '../customers/customer-preferences.service.js';
import { type CustomerScopes, CustomersService } from '../customers/customers.service.js';
import { type DealScopes, DealsService } from '../deals/deals.service.js';
import { DISPLAY_TIME_ZONE } from '../notifications/notification-values.js';
import {
  type Actor,
  PropertiesService,
  type PropertyScopes,
} from '../properties/properties.service.js';
import { AiGatewayService } from './ai-gateway.service.js';
import {
  ACTIVITY_TYPE_LABELS,
  CUSTOMER_PURPOSE_LABELS,
  CUSTOMER_STATUS_LABELS,
  labelOf,
  preferenceFacts,
  PURCHASE_TIMELINE_LABELS,
} from './customer-facts.js';
import { propertyFacts, vnMoney } from './property-facts.js';
import { hidePhones } from './redact.js';
import {
  MAX_NEXT_STEPS,
  MAX_RISKS,
  MAX_TALKING_POINTS,
  SALES_ACTIVITY_LIMIT,
  SALES_ASSISTANT_SYSTEM_PROMPT,
  SALES_ASSISTANT_TOOL,
  salesAssistantTool,
} from './sales-assistant.tool.js';

const MAX_TEXT_LENGTH = 500;
const MAX_FACT_LENGTH = 500;

const DEAL_STAGE_LABELS: Readonly<Record<string, string>> = {
  NEGOTIATING: 'Đang thương lượng',
  DEPOSIT: 'Đặt cọc',
  CONTRACT: 'Hợp đồng',
  WON: 'Thành công',
  LOST: 'Thất bại',
};

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TIME_ZONE, dateStyle: 'short' });

/** Gợi ý chốt giao dịch AI viết (TASK-142). */
export interface AiSalesAssist {
  dealId: string;
  situation: string;
  nextSteps: string[];
  talkingPoints: string[];
  risks: string[];
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

/** Không xem được (404) thì trả null; lỗi khác vẫn ném. */
async function ifVisible<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof AppException && error.code === ErrorCode.NOT_FOUND) {
      return null;
    }
    throw error;
  }
}

/**
 * Trợ lý bán hàng (TASK-142): AI gợi ý cách đưa một giao dịch tới bước tiếp theo. Xem giao dịch theo
 * `deal.view`; thông số BĐS và thông tin khách chỉ gửi AI khi người hỏi cũng xem được BĐS/khách đó (không thì
 * chỉ có mã, tiêu đề BĐS như trong giao dịch). Không gửi tên, liên hệ của khách hay chủ nhà.
 */
@Injectable()
export class AiSalesAssistantService {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly deals: DealsService,
    private readonly properties: PropertiesService,
    private readonly customers: CustomersService,
    private readonly preferences: CustomerPreferencesService,
    private readonly activities: CustomerActivitiesService,
    private readonly dataSource: DataSource,
  ) {}

  async assist(
    user: AuthenticatedUser,
    actor: Actor,
    dealId: string,
    scopes: { deal: DealScopes; property: PropertyScopes; customer: CustomerScopes },
  ): Promise<AiSalesAssist> {
    const deal = await this.deals.findOne(actor, dealId, scopes.deal);
    const property = await ifVisible(() =>
      this.properties.findOne(actor, deal.property.id, scopes.property),
    );
    const customer = await ifVisible(() =>
      this.customers.findOne(actor, deal.customer.id, scopes.customer),
    );

    let customerFacts: Record<string, unknown> | null = null;
    if (customer) {
      const needs = (await this.preferences.findAll(actor, customer.id, scopes.customer)).filter(
        (preference) => preference.isActive,
      );
      const query = Object.assign(new PaginationQueryDto(), { pageSize: SALES_ACTIVITY_LIMIT });
      const recent = (await this.activities.findAll(actor, customer.id, query, scopes.customer))
        .items;
      customerFacts = {
        buoc: labelOf(CUSTOMER_STATUS_LABELS, customer.status),
        muc_dich: labelOf(CUSTOMER_PURPOSE_LABELS, customer.purpose),
        thoi_gian_mua: labelOf(PURCHASE_TIMELINE_LABELS, customer.purchaseTimeline),
        nhu_cau: await preferenceFacts(this.dataSource, needs),
        hoat_dong_gan_nhat: [...recent].reverse().map((activity) => ({
          ngay: DAY.format(activity.occurredAt),
          loai: labelOf(ACTIVITY_TYPE_LABELS, activity.type),
          noi_dung: fact(activity.content),
        })),
      };
    }

    const facts = {
      hom_nay: DAY.format(new Date()),
      giao_dich: {
        buoc: labelOf(DEAL_STAGE_LABELS, deal.stage),
        gia_chot: deal.dealPrice === null ? null : vnMoney(deal.dealPrice),
        tien_coc: deal.depositAmount === null ? null : vnMoney(deal.depositAmount),
        ngay_coc: deal.depositAt ? DAY.format(deal.depositAt) : null,
        ngay_tao: DAY.format(deal.createdAt),
        ghi_chu: fact(deal.notes),
      },
      bat_dong_san: property
        ? propertyFacts(property)
        : { ma: deal.property.code, tieu_de: deal.property.title },
      khach_hang: customerFacts,
    };

    const response = await this.gateway.complete(user, {
      feature: 'sales_assistant',
      system: SALES_ASSISTANT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(facts) }],
      tools: [salesAssistantTool],
      forceTool: SALES_ASSISTANT_TOOL,
      maxTokens: 1536,
    });
    const input = response.toolCalls.find((call) => call.name === SALES_ASSISTANT_TOOL)?.input;
    const situation = cleanText(input?.['situation']);
    if (!input || situation === '') {
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'AI chưa gợi ý được cho giao dịch, vui lòng thử lại',
      );
    }
    return {
      dealId: deal.id,
      situation,
      nextSteps: cleanList(input['nextSteps'], MAX_NEXT_STEPS),
      talkingPoints: cleanList(input['talkingPoints'], MAX_TALKING_POINTS),
      risks: cleanList(input['risks'], MAX_RISKS),
    };
  }
}
