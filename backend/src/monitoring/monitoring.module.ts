import { Global, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';

import { MetricsController } from './metrics.controller.js';
import { MetricsMiddleware } from './metrics.middleware.js';
import { MetricsService } from './metrics.service.js';

/** Giám sát (TASK-158, docs/monitoring.md): MetricsService dùng chung cho job định kỳ ở mọi module. */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MonitoringModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(MetricsMiddleware).forRoutes('*path');
  }
}
