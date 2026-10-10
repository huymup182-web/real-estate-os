import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { actorOf, scopesOf } from '../properties/properties.controller.js';
import { type AiListing, AiListingService } from './ai-listing.service.js';
import { AiListingDto } from './dto/ai-listing.dto.js';

/** AI viết tin đăng BĐS (TASK-136). Mỗi lần gọi tính một lượt AI (TASK-133). */
@Controller()
export class AiListingController {
  constructor(private readonly listings: AiListingService) {}

  /**
   * `POST /api/v1/properties/:id/ai-listing` `{style?: PROFESSIONAL | SHORT | FACEBOOK}` → {property, style, title,
   * description}. BĐS ngoài phạm vi `property.view` → 404. Chỉ trả bản nháp, không sửa BĐS.
   */
  @Post('properties/:id/ai-listing')
  @HttpCode(200)
  @RequirePermission('property.view')
  write(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: AiListingDto,
  ): Promise<AiListing> {
    return this.listings.write(
      req.user,
      actorOf(tenantId, req.user),
      id,
      scopesOf(req.user),
      dto.style ?? 'PROFESSIONAL',
    );
  }
}
