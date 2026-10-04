import type { INestApplication, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';

/** Tiền tố chung cho mọi API (phase0/05-API-CONVENTIONS.md). */
export const API_PREFIX = 'api/v1';

/**
 * Tạo ứng dụng với cấu hình dùng chung cho cả main.ts và test.
 * Test có thể truyền module gốc khác (import AppModule kèm controller thử) để dùng cùng cấu hình.
 */
export async function createApp(rootModule: Type = AppModule): Promise<INestApplication> {
  const app = await NestFactory.create(rootModule, { logger: ['error', 'warn', 'log'] });
  app.setGlobalPrefix(API_PREFIX);
  // Đóng kết nối gọn gàng khi container nhận SIGTERM.
  app.enableShutdownHooks();
  return app;
}
