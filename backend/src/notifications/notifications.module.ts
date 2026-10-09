import { Module } from '@nestjs/common';

import { PropertiesModule } from '../properties/properties.module.js';
import { SavedSearchesController } from './saved-searches.controller.js';
import { SavedSearchesService } from './saved-searches.service.js';

/**
 * Module thông báo (phase0/02-ARCHITECTURE.md mục 2.1: notifications, device_tokens, saved_searches).
 * Hiện có tìm kiếm đã lưu (TASK-075); gửi thông báo khi có BĐS mới khớp làm ở Phase 8.
 */
@Module({
  imports: [PropertiesModule],
  controllers: [SavedSearchesController],
  providers: [SavedSearchesService],
})
export class NotificationsModule {}
