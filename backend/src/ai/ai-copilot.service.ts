import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';

import type { AuthenticatedUser } from '../auth/access-token.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { type CustomerScopes, CustomersService } from '../customers/customers.service.js';
import { MatchingService } from '../matching/matching.service.js';
import { DISPLAY_TIME_ZONE } from '../notifications/notification-values.js';
import {
  type Actor,
  PropertiesService,
  type PropertyScopes,
} from '../properties/properties.service.js';
import type { PropertyResponse } from '../properties/property.response.js';
import { PropertySearchQueryDto } from '../search/property-search-query.dto.js';
import { AiCustomerSummaryService } from './ai-customer-summary.service.js';
import { AiFollowUpService } from './ai-follow-up.service.js';
import { AiGatewayService } from './ai-gateway.service.js';
import { AiPropertySearchService } from './ai-property-search.service.js';
import {
  COPILOT_PROPERTY_LIMIT,
  COPILOT_TOOL_CALLS_PER_ROUND,
  COPILOT_TOOL_ROUNDS,
  COPILOT_TOOLS,
  copilotSystemPrompt,
  currentCustomerTool,
  followUpCustomersTool,
  getPropertyTool,
  matchingPropertiesTool,
  searchPropertiesTool,
} from './copilot.tools.js';
import type { AiCopilotDto } from './dto/ai-copilot.dto.js';
import type { LlmMessage, LlmTool, LlmToolCall, LlmToolResult } from './llm-provider.js';
import { PROPERTY_STATUS_LABELS, propertyFacts, vnArea, vnMoney } from './property-facts.js';
import { hidePhones } from './redact.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TIME_ZONE, dateStyle: 'short' });
const MAX_REPLY_LENGTH = 4000;
/** Độ dài tối đa mô tả BĐS gửi LLM. */
const MAX_DESCRIPTION_LENGTH = 1500;

/** BĐS tool đã trả về, app hiện thành thẻ bấm vào xem chi tiết. */
export interface CopilotPropertyCard {
  id: string;
  code: string;
  title: string;
  transactionType: string;
  propertyType: string;
  price: number;
  area: number;
}

/** Khách tool đã trả về dưới mã K1, K2…; tên chỉ trả cho app, không gửi LLM. */
export interface CopilotCustomerCard {
  ref: string;
  id: string;
  fullName: string;
  status: string;
}

export interface AiCopilotReply {
  reply: string;
  /** Tên các tool Copilot đã chạy, theo thứ tự chạy lần đầu. */
  toolsUsed: string[];
  properties: CopilotPropertyCard[];
  customers: CopilotCustomerCard[];
}

interface CopilotScopes {
  property: PropertyScopes;
  customer: CustomerScopes;
}

/** Một câu hỏi Copilot: người hỏi, ngữ cảnh và những gì các tool đã trả. */
interface CopilotRun {
  actor: Actor;
  scopes: CopilotScopes;
  customerId: string | null;
  tools: Set<string>;
  toolsUsed: Set<string>;
  properties: Map<string, CopilotPropertyCard>;
  customers: Map<string, CopilotCustomerCard>;
}

/** Lỗi tool trả LLM (không tìm thấy, sai tham số); LLM đọc rồi tự trả lời người dùng. */
class ToolError extends Error {}

function daysSince(date: Date): number {
  return Math.max(Math.floor((Date.now() - date.getTime()) / DAY_MS), 0);
}

function card(property: PropertyResponse): CopilotPropertyCard {
  const { id, code, title, transactionType, propertyType, price, area } = property;
  return { id, code, title, transactionType, propertyType, price, area };
}

/**
 * AI Copilot (TASK-143, MASTER_PLAN mục 20): môi giới hỏi bằng câu tự nhiên, LLM gọi tool để lấy dữ liệu.
 * LLM không truy cập database: backend chạy từng tool qua service layer với quyền, phạm vi xem và tenant của
 * người hỏi, rồi gửi lại kết quả. Không gửi LLM tên, liên hệ khách, chủ nhà hay địa chỉ chi tiết; số điện thoại
 * (kể cả trong câu người dùng gõ) bị ẩn. Không lưu hội thoại. Mỗi lần gọi LLM tính một lượt AI.
 */
@Injectable()
export class AiCopilotService {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly properties: PropertiesService,
    private readonly customers: CustomersService,
    private readonly matching: MatchingService,
    private readonly propertySearch: AiPropertySearchService,
    private readonly customerSummary: AiCustomerSummaryService,
    private readonly followUps: AiFollowUpService,
  ) {}

  async ask(
    user: AuthenticatedUser,
    actor: Actor,
    dto: AiCopilotDto,
    scopes: CopilotScopes,
  ): Promise<AiCopilotReply> {
    const canViewProperties = scopes.property.view !== undefined;
    const canViewCustomers = scopes.customer.view !== undefined;
    const { customerId = null, propertyId = null } = dto.context ?? {};
    if (
      (!canViewProperties && !canViewCustomers) ||
      (customerId && !canViewCustomers) ||
      (propertyId && !canViewProperties)
    ) {
      throw new AppException(ErrorCode.FORBIDDEN);
    }
    checkTurns(dto.messages);
    // Ngữ cảnh ngoài phạm vi xem → 404 trước khi gọi AI.
    const propertyCode = propertyId
      ? (await this.properties.findOne(actor, propertyId, scopes.property)).code
      : null;
    if (customerId) {
      await this.customers.findOne(actor, customerId, scopes.customer);
    }

    const tools: LlmTool[] = [
      ...(canViewProperties ? [searchPropertiesTool, getPropertyTool] : []),
      ...(canViewCustomers && customerId ? [currentCustomerTool] : []),
      ...(canViewCustomers && canViewProperties && customerId ? [matchingPropertiesTool] : []),
      ...(canViewCustomers ? [followUpCustomersTool] : []),
    ];
    const run: CopilotRun = {
      actor,
      scopes,
      customerId,
      tools: new Set(tools.map((tool) => tool.name)),
      toolsUsed: new Set(),
      properties: new Map(),
      customers: new Map(),
    };
    const system = copilotSystemPrompt({
      today: DAY.format(new Date()),
      propertyCode,
      hasCustomer: customerId !== null,
    });
    const messages: LlmMessage[] = dto.messages.map((message) => ({
      role: message.role,
      content: hidePhones(message.content),
    }));

    const reply = await this.converse(user, run, system, messages, tools);
    const text = hidePhones(reply).trim().slice(0, MAX_REPLY_LENGTH).trim();
    if (text === '') {
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'AI chưa trả lời được, vui lòng thử lại',
      );
    }
    return {
      reply: text,
      toolsUsed: [...run.toolsUsed],
      properties: [...run.properties.values()],
      customers: [...run.customers.values()],
    };
  }

  /** Gọi LLM, chạy tool LLM xin rồi gửi lại kết quả cho tới khi LLM trả lời chữ; trả câu trả lời. */
  private async converse(
    user: AuthenticatedUser,
    run: CopilotRun,
    system: string,
    messages: LlmMessage[],
    tools: LlmTool[],
  ): Promise<string> {
    for (let round = 0; ; round += 1) {
      const last = round === COPILOT_TOOL_ROUNDS;
      const response = await this.gateway.complete(user, {
        feature: 'copilot',
        system,
        messages,
        tools,
        maxTokens: 2048,
        ...(last ? { noToolCalls: true } : {}),
      });
      if (last || response.toolCalls.length === 0) {
        return response.text;
      }
      messages.push({ role: 'assistant', content: response.text, toolCalls: response.toolCalls });
      const toolResults: LlmToolResult[] = [];
      for (const [index, call] of response.toolCalls.entries()) {
        toolResults.push(
          index < COPILOT_TOOL_CALLS_PER_ROUND
            ? await this.runTool(run, call)
            : { toolCallId: call.id, content: 'Gọi quá nhiều tool một lần', isError: true },
        );
      }
      messages.push({ role: 'user', content: '', toolResults });
    }
  }

  private async runTool(run: CopilotRun, call: LlmToolCall): Promise<LlmToolResult> {
    if (!run.tools.has(call.name)) {
      return { toolCallId: call.id, content: `Không có tool ${call.name}`, isError: true };
    }
    run.toolsUsed.add(call.name);
    try {
      const result = await this.tool(run, call);
      return { toolCallId: call.id, content: JSON.stringify(result) };
    } catch (error) {
      if (error instanceof ToolError) {
        return { toolCallId: call.id, content: error.message, isError: true };
      }
      throw error;
    }
  }

  private async tool(run: CopilotRun, call: LlmToolCall): Promise<unknown> {
    const { actor, scopes } = run;
    switch (call.name) {
      case COPILOT_TOOLS.searchProperties: {
        const { filters, unresolved } = await this.propertySearch.filtersFrom(call.input);
        const query = plainToInstance(PropertySearchQueryDto, {
          ...filters,
          pageSize: COPILOT_PROPERTY_LIMIT,
        });
        const page = await this.properties.findAll(actor, query, scopes.property);
        for (const row of page.items) {
          run.properties.set(row.id, card(row));
        }
        return {
          tong_so_ket_qua: page.meta.total,
          bds: page.items.map((row) => ({
            ...propertyFacts(row),
            trang_thai: PROPERTY_STATUS_LABELS[row.status] ?? row.status,
            so_ngay_da_dang: daysSince(row.createdAt),
          })),
          ...(unresolved.length > 0 ? { khu_vuc_chua_tim_thay: unresolved } : {}),
        };
      }
      case COPILOT_TOOLS.getProperty: {
        const code = typeof call.input['code'] === 'string' ? call.input['code'].trim() : '';
        const found = code
          ? await this.properties
              .visible(actor, scopes.property)
              .andWhere('p.code = :code', { code: code.toUpperCase() })
              .getOne()
          : null;
        if (!found) {
          throw new ToolError(`Không tìm thấy BĐS mã "${code}" trong phạm vi người dùng xem được`);
        }
        const property = await this.properties.findOne(actor, found.id, scopes.property);
        run.properties.set(property.id, card(property));
        return {
          ...propertyFacts(property),
          trang_thai: PROPERTY_STATUS_LABELS[property.status] ?? property.status,
          so_ngay_da_dang: daysSince(property.createdAt),
          mo_ta: property.description
            ? hidePhones(property.description).slice(0, MAX_DESCRIPTION_LENGTH)
            : null,
        };
      }
      case COPILOT_TOOLS.currentCustomer: {
        const { facts } = await this.customerSummary.facts(
          actor,
          this.contextCustomer(run),
          scopes.customer,
        );
        return facts;
      }
      case COPILOT_TOOLS.matchingProperties: {
        const matches = await this.matching.propertiesForCustomer(
          actor,
          this.contextCustomer(run),
          scopes,
          { limit: COPILOT_PROPERTY_LIMIT },
        );
        return matches.map((match) => {
          const { property } = match;
          run.properties.set(property.id, { ...property });
          return {
            ma: property.code,
            tieu_de: property.title,
            gia: vnMoney(property.price),
            dien_tich: vnArea(property.area),
            diem_phu_hop: `${match.score}%`,
          };
        });
      }
      case COPILOT_TOOLS.followUpCustomers: {
        const { candidates, facts } = await this.followUps.candidates(actor, scopes.customer);
        candidates.forEach((candidate, index) => {
          const ref = `K${String(index + 1)}`;
          run.customers.set(ref, {
            ref,
            id: candidate.id,
            fullName: candidate.fullName,
            status: candidate.status,
          });
        });
        return facts;
      }
      default:
        throw new ToolError(`Không có tool ${call.name}`);
    }
  }

  private contextCustomer(run: CopilotRun): string {
    if (!run.customerId) {
      throw new ToolError('Người dùng chưa mở khách nào');
    }
    return run.customerId;
  }
}

/** Lượt đầu và lượt cuối là câu hỏi của người dùng, hai lượt liền nhau khác người nói. */
function checkTurns(messages: AiCopilotDto['messages']): void {
  const alternating = messages.every(
    (message, index) => message.role === (index % 2 === 0 ? 'user' : 'assistant'),
  );
  if (!alternating || messages.at(-1)?.role !== 'user') {
    throw new AppException(ErrorCode.VALIDATION_ERROR, undefined, [
      {
        field: 'messages',
        message:
          'messages phải bắt đầu và kết thúc bằng câu hỏi của user, user và assistant xen kẽ',
      },
    ]);
  }
}
