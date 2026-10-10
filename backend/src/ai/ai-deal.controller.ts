import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { customerScopesOf } from '../customers/customers.controller.js';
import { dealScopesOf } from '../deals/deals.controller.js';
import { actorOf, scopesOf } from '../properties/properties.controller.js';
import { type AiSalesAssist, AiSalesAssistantService } from './ai-sales-assistant.service.js';

/** AI cho giao dịch (TASK-142). Mỗi lần gọi tính một lượt AI (TASK-133). */
@Controller()
export class AiDealController {
  constructor(private readonly assistant: AiSalesAssistantService) {}

  /**
   * `POST /api/v1/deals/:id/ai-assistant` → {dealId, situation, nextSteps, talkingPoints, risks}. Giao dịch
   * ngoài phạm vi `deal.view` → 404. Chỉ trả gợi ý, không sửa giao dịch.
   */
  @Post('deals/:id/ai-assistant')
  @HttpCode(200)
  @RequirePermission('deal.view')
  assist(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<AiSalesAssist> {
    return this.assistant.assist(req.user, actorOf(tenantId, req.user), id, {
      deal: dealScopesOf(req.user),
      property: scopesOf(req.user),
      customer: customerScopesOf(req.user),
    });
  }
}
