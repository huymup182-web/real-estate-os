import { Controller, Get, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { AiGatewayService, type AiStatus } from './ai-gateway.service.js';

/**
 * Trạng thái AI cho app (TASK-133). Chỉ cần đăng nhập: app dựa vào đây để ẩn/hiện tính năng AI và báo số
 * lượt còn lại. Không có API gọi LLM tự do; mỗi tính năng AI có API riêng với quyền của nghiệp vụ đó.
 */
@Controller('ai')
export class AiController {
  constructor(private readonly gateway: AiGatewayService) {}

  /** `GET /api/v1/ai/status` → {enabled, dailyLimit, used, remaining} của người đang đăng nhập. */
  @Get('status')
  status(@Req() req: { user: RequestUser }): Promise<AiStatus> {
    return this.gateway.status(req.user);
  }
}
