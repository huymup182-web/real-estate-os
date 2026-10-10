import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { AiGatewayService, type AiStatus } from './ai-gateway.service.js';
import {
  type AiPropertySearchResult,
  AiPropertySearchService,
} from './ai-property-search.service.js';
import { AiPropertySearchDto } from './dto/ai-property-search.dto.js';

/**
 * API AI cho app. Không có API gọi LLM tự do; mỗi tính năng AI có route riêng với quyền của nghiệp vụ đó.
 */
@Controller('ai')
export class AiController {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly propertySearch: AiPropertySearchService,
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
}
