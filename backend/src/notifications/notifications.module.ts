import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { APP_CONFIG } from '../config/app-config.module.js';
import { MatchingModule } from '../matching/matching.module.js';
import { PropertiesModule } from '../properties/properties.module.js';
import { AppointmentReminderJob } from './appointment-reminder.job.js';
import { DeviceTokenStore } from './device-token-store.js';
import { DeviceTokensController } from './device-tokens.controller.js';
import { DeviceTokensService } from './device-tokens.service.js';
import { pushSenderFor } from './fcm-push-sender.js';
import { MatchingNotifier } from './matching-notifier.js';
import { NewPropertyNotifier } from './new-property-notifier.js';
import { NotificationsService } from './notifications.service.js';
import { PushSender } from './push-sender.js';
import { SavedSearchesController } from './saved-searches.controller.js';
import { SavedSearchesService } from './saved-searches.service.js';

/**
 * Module thông báo (phase0/02-ARCHITECTURE.md mục 2.1: notifications, device_tokens, saved_searches).
 * Có tìm kiếm đã lưu (TASK-075) và `NotificationsService` gửi thông báo (TASK-092; kênh đẩy mặc định
 * `NoopPushSender`). Có FCM_CONFIG thì đẩy qua FCM (TASK-093); token thiết bị ở
 * bảng `device_tokens`, API `/device-tokens` (TASK-094).
 * `NewPropertyNotifier` báo BĐS mới khớp tìm kiếm đã lưu (TASK-095),
 * `MatchingNotifier` báo môi giới khi BĐS mới phù hợp khách của họ (TASK-096),
 * `AppointmentReminderJob` nhắc lịch hẹn (TASK-097).
 */
@Module({
  imports: [PropertiesModule, AuthModule, MatchingModule],
  controllers: [SavedSearchesController, DeviceTokensController],
  providers: [
    SavedSearchesService,
    NotificationsService,
    NewPropertyNotifier,
    MatchingNotifier,
    AppointmentReminderJob,
    DeviceTokensService,
    { provide: DeviceTokenStore, useExisting: DeviceTokensService },
    {
      provide: PushSender,
      inject: [APP_CONFIG, DeviceTokenStore],
      useFactory: pushSenderFor,
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
