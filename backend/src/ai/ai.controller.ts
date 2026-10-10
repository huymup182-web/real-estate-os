import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import { customerScopesOf } from '../customers/customers.controller.js';
import { actorOf, scopesOf } from '../properties/properties.controller.js';
import { type AiCopilotReply, AiCopilotService } from './ai-copilot.service.js';
import { AiGatewayService, type AiStatus } from './ai-gateway.service.js';
import {
  type AiPropertySearchResult,
  AiPropertySearchService,
} from './ai-property-search.service.js';
import { AiCopilotDto } from './dto/ai-copilot.dto.js';
import { AiPropertySearchDto } from './dto/ai-property-search.dto.js';

/**
 * API AI cho app. Không có API gọi LLM tự do; mỗi tính năng AI có route riêng với quyền của nghiệp vụ đó.
 */
@Controller('ai')
export class AiController {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly propertySearch: AiPropertySearchService,
    private readonly copilot: AiCopilotService,
  ) {}

  /**
   * `GET /api/v1/ai/status` → {enabled, dailyLimit, used, remaining} của người đang đăng nhập (TASK-133).
   * Chỉ cần đăng nhập: app dựa vào đây để ẩn/hiện tính năng AI và báo số lượt còn lại.
   */
  @Get('status')
  status(@Req() req: { user: RequestUser }): Promise<AiStatus> {
    return this.gateway.status(req.user);
  }

  /**
   * `POST /api/v1/ai/property-search` {query} → {filters, explanation, unresolved} (TASK-134). App gửi
   * `filters` lên `GET /properties` để lấy kết quả, nên phạm vi xem BĐS giữ nguyên.
   */
  @Post('property-search')
  @HttpCode(200)
  @RequirePermission('property.view')
  searchProperties(
    @Req() req: { user: RequestUser },
    @Body() dto: AiPropertySearchDto,
  ): Promise<AiPropertySearchResult> {
    return this.propertySearch.search(req.user, dto.query);
  }

  /**
   * `POST /api/v1/ai/copilot` {messages, context?} → {reply, toolsUsed, properties, customers} (TASK-143). Cần
   * `property.view` hoặc `customer.view`; Copilot chỉ có tool của quyền người hỏi có. Ngữ cảnh ngoài phạm vi
   * xem → 404. Mỗi lần gọi LLM tính một lượt AI, một câu hỏi tối đa 4 lượt.
   */
  @Post('copilot')
  @HttpCode(200)
  ask(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Body() dto: AiCopilotDto,
  ): Promise<AiCopilotReply> {
    return this.copilot.ask(req.user, actorOf(tenantId, req.user), dto, {
      property: scopesOf(req.user),
      customer: customerScopesOf(req.user),
    });
  }
}
