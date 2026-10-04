import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';

import { AllExceptionsFilter } from './errors/all-exceptions.filter.js';
import { RequestIdMiddleware } from './request-id/request-id.middleware.js';
import { createValidationPipe } from './validation/validation.pipe.js';

/** Thành phần dùng chung cho mọi request: request id, kiểm tra dữ liệu đầu vào và bộ lọc lỗi chung. */
@Module({
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
  ],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*path');
  }
}
