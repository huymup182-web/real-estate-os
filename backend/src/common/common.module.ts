import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { AllExceptionsFilter } from './errors/all-exceptions.filter.js';
import { RequestIdMiddleware } from './request-id/request-id.middleware.js';

/** Thành phần dùng chung cho mọi request: request id và bộ lọc lỗi chung. */
@Module({
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*path');
  }
}
