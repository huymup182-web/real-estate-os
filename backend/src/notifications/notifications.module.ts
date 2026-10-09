import { Module } from '@nestjs/common';

import { PropertiesModule } from '../properties/properties.module.js';
import { NotificationsService } from './notifications.service.js';
import { NoopPushSender, PushSender } from './push-sender.js';
import { SavedSearchesController } from './saved-searches.controller.js';
import { SavedSearchesService } from './saved-searches.service.js';

/**
 * Module thông báo (phase0/02-ARCHITECTURE.md mục 2.1: notifications, device_tokens, saved_searches).
 * Có tìm kiếm đã lưu (TASK-075) và `NotificationsService` gửi thông báo (TASK-092; kênh đẩy mặc định
 * `NoopPushSender`, FCM ở TASK-093).
 */
@Module({
  imports: [PropertiesModule],
  controllers: [SavedSearchesController],
  providers: [
    SavedSearchesService,
    NotificationsService,
    { provide: PushSender, useClass: NoopPushSender },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
