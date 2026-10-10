import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { customerScopesOf } from '../customers/customers.controller.js';
import { actorOf } from '../properties/properties.controller.js';
import { type AiCustomerSummary, AiCustomerSummaryService } from './ai-customer-summary.service.js';
import { type AiFollowUps, AiFollowUpService } from './ai-follow-up.service.js';

/** AI cho khách hàng (TASK-140, TASK-141). Mỗi lần gọi AI tính một lượt (TASK-133). */
@Controller()
export class AiCustomerController {
  constructor(
    private readonly summaries: AiCustomerSummaryService,
    private readonly followUps: AiFollowUpService,
  ) {}

  /**
   * `POST /api/v1/ai/follow-ups` → {thresholdDays, items: [{customer, lastContactAt, daysSinceContact,
   * suggestion {action, reason, message} | null}]}: tối đa 10 khách trong phạm vi `customer.view` cần chăm sóc,
   * AI gợi ý việc làm tiếp. Không có khách nào thì `items` rỗng và không gọi AI.
   */
  @Post('ai/follow-ups')
  @HttpCode(200)
  @RequirePermission('customer.view')
  suggestFollowUps(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
  ): Promise<AiFollowUps> {
    return this.followUps.suggest(
      req.user,
      actorOf(tenantId, req.user),
      customerScopesOf(req.user),
    );
  }

  /**
   * `POST /api/v1/customers/:id/ai-summary` → {customerId, summary, keyPoints, openQuestions, activityCount}.
   * Khách ngoài phạm vi `customer.view` → 404. Chỉ trả kết quả, không lưu.
   */
  @Post('customers/:id/ai-summary')
  @HttpCode(200)
  @RequirePermission('customer.view')
  summarize(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<AiCustomerSummary> {
    return this.summaries.summarize(
      req.user,
      actorOf(tenantId, req.user),
      id,
      customerScopesOf(req.user),
    );
  }
}
