import { Global, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { CrashReportsController } from './crash-reports.controller.js';
import { MetricsController } from './metrics.controller.js';
import { MetricsMiddleware } from './metrics.middleware.js';
import { MetricsService } from './metrics.service.js';

/**
 * Giám sát (TASK-158, docs/monitoring.md): MetricsService dùng chung cho job định kỳ ở mọi module. Nhận báo cáo lỗi
 * từ client (TASK-159, docs/crash-reporting.md).
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [MetricsController, CrashReportsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MonitoringModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(MetricsMiddleware).forRoutes('*path');
  }
}
