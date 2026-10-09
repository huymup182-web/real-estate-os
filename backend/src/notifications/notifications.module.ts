import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { APP_CONFIG } from '../config/app-config.module.js';
import { PropertiesModule } from '../properties/properties.module.js';
import { DeviceTokenStore } from './device-token-store.js';
import { DeviceTokensController } from './device-tokens.controller.js';
import { DeviceTokensService } from './device-tokens.service.js';
import { pushSenderFor } from './fcm-push-sender.js';
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
 * `NewPropertyNotifier` báo BĐS mới khớp tìm kiếm đã lưu (TASK-095).
 */
@Module({
  imports: [PropertiesModule, AuthModule],
  controllers: [SavedSearchesController, DeviceTokensController],
  providers: [
    SavedSearchesService,
    NotificationsService,
    NewPropertyNotifier,
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
