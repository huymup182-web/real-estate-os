import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { customerScopesOf } from '../customers/customers.controller.js';
import { actorOf, scopesOf } from '../properties/properties.controller.js';
import {
  type AiMatchExplanation,
  AiMatchExplanationService,
} from './ai-match-explanation.service.js';

/** AI giải thích kết quả matching (TASK-135). Mỗi lần gọi tính một lượt AI (TASK-133). */
@Controller()
export class AiMatchingController {
  constructor(private readonly explanations: AiMatchExplanationService) {}

  /**
   * `POST /api/v1/customers/:customerId/matching-properties/:propertyId/ai-explanation` →
   * {property, score, criteria, explanation, ai {summary, strengths, concerns, pitch}}. Khách ngoài phạm vi
   * `customer.view` hoặc BĐS ngoài phạm vi xem → 404; khách không có nhu cầu cùng loại giao dịch → 422.
   */
  @Post('customers/:customerId/matching-properties/:propertyId/ai-explanation')
  @HttpCode(200)
  @RequirePermission('customer.view')
  explain(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('customerId', ParseUuidPipe) customerId: string,
    @Param('propertyId', ParseUuidPipe) propertyId: string,
  ): Promise<AiMatchExplanation> {
    return this.explanations.explain(
      req.user,
      actorOf(tenantId, req.user),
      customerId,
      propertyId,
      {
        property: scopesOf(req.user),
        customer: customerScopesOf(req.user),
      },
    );
  }
}
