import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';

import { AllExceptionsFilter } from './errors/all-exceptions.filter.js';
import { RequestLoggerMiddleware } from './logging/request-logger.middleware.js';
import { ResponseInterceptor } from './response/response.interceptor.js';
import { RequestIdMiddleware } from './request-id/request-id.middleware.js';
import { createValidationPipe } from './validation/validation.pipe.js';

/**
 * Thành phần dùng chung cho mọi request: request id, log request, kiểm tra dữ liệu đầu vào,
 * định dạng response thành công và bộ lọc lỗi chung.
 */
@Module({
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, RequestLoggerMiddleware).forRoutes('*path');
  }
}
