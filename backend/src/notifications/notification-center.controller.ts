import { Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import type { Paginated } from '../common/response/paginated.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { NotificationListQueryDto } from './dto/notification-list-query.dto.js';
import {
  NotificationCenterService,
  type NotificationResponse,
} from './notification-center.service.js';

/**
 * Trung tâm thông báo (TASK-099): hộp thư của người đang đăng nhập. Chỉ cần đăng nhập, không cần
 * permission; mỗi người chỉ thấy thông báo của chính mình.
 */
@Controller('notifications')
export class NotificationCenterController {
  constructor(private readonly center: NotificationCenterService) {}

  /** `GET /api/v1/notifications?unread=true&type=A,B&page=1&pageSize=20` → mới nhất trước. */
  @Get()
  findAll(
    @Req() req: { user: RequestUser },
    @Query() query: NotificationListQueryDto,
  ): Promise<Paginated<NotificationResponse>> {
    return this.center.findAll(req.user, query);
  }

  /** `GET /api/v1/notifications/unread-count` → `{count}`. */
  @Get('unread-count')
  unreadCount(@Req() req: { user: RequestUser }): Promise<{ count: number }> {
    return this.center.unreadCount(req.user);
  }

  /** `POST /api/v1/notifications/read-all` → `{count}` số thông báo vừa đánh dấu đã đọc. */
  @Post('read-all')
  @HttpCode(200)
  markAllRead(@Req() req: { user: RequestUser }): Promise<{ count: number }> {
    return this.center.markAllRead(req.user);
  }

  /** `POST /api/v1/notifications/:id/read` → thông báo đã đánh dấu đọc. */
  @Post(':id/read')
  @HttpCode(200)
  markRead(
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<NotificationResponse> {
    return this.center.markRead(req.user, id);
  }
}
