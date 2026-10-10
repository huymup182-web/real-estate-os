import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { actorOf, scopesOf } from '../properties/properties.controller.js';
import { type AiValuation, AiValuationService } from './ai-valuation.service.js';

/** Định giá AI BĐS (TASK-149). Mỗi lần gọi tính một lượt AI (TASK-133). */
@Controller()
export class AiValuationController {
  constructor(private readonly valuations: AiValuationService) {}

  /**
   * `POST /api/v1/properties/:id/ai-valuation` → {estimate, range, base, adjustmentPercent, confidence, factors,
   * summary, comparables, ...}. BĐS ngoài phạm vi `property.view` → 404; dưới 3 BĐS tương tự → 422 (không gọi AI).
   * Chỉ trả kết quả tham khảo, không sửa BĐS.
   */
  @Post('properties/:id/ai-valuation')
  @HttpCode(200)
  @RequirePermission('property.view')
  value(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<AiValuation> {
    return this.valuations.value(req.user, actorOf(tenantId, req.user), id, scopesOf(req.user));
  }
}
