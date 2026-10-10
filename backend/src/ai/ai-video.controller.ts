import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { actorOf, scopesOf } from '../properties/properties.controller.js';
import { type AiVideo, AiVideoService } from './ai-video.service.js';
import { AiVideoDto } from './dto/ai-video.dto.js';
import { VIDEO_DEFAULT_DURATION } from './video.js';

/** Video AI giới thiệu BĐS (TASK-150). Mỗi lần gọi tính một lượt AI (TASK-133). */
@Controller()
export class AiVideoController {
  constructor(private readonly videos: AiVideoService) {}

  /**
   * `POST /api/v1/properties/:id/ai-video` `{durationSeconds?: 15 | 30 | 45 | 60}` → {property, durationSeconds,
   * scenes}. BĐS ngoài phạm vi `property.view` → 404; chưa có ảnh → 422 (không gọi AI).
   */
  @Post('properties/:id/ai-video')
  @HttpCode(200)
  @RequirePermission('property.view')
  create(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: AiVideoDto,
  ): Promise<AiVideo> {
    return this.videos.create(
      req.user,
      actorOf(tenantId, req.user),
      id,
      scopesOf(req.user),
      dto.durationSeconds ?? VIDEO_DEFAULT_DURATION,
    );
  }
}
