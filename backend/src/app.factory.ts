import type { INestApplication, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { AppLogger } from './common/logging/app-logger.js';
import { securityHeaders } from './common/security/security-headers.js';
import { type AppConfig, loadLogLevel } from './config/app-config.js';
import { APP_CONFIG } from './config/app-config.module.js';

/** Tiền tố chung cho mọi API (phase0/05-API-CONVENTIONS.md). */
export const API_PREFIX = 'api/v1';

/**
 * Tạo ứng dụng với cấu hình dùng chung cho cả main.ts và test.
 * Test có thể truyền module gốc khác (import AppModule kèm controller thử) để dùng cùng cấu hình.
 */
export async function createApp(rootModule: Type = AppModule): Promise<INestApplication> {
  const app = await NestFactory.create(rootModule, {
    // Log JSON kèm requestId/tenantId/userId (TASK-034); mức log theo LOG_LEVEL.
    logger: new AppLogger(loadLogLevel()),
  });
  app.setGlobalPrefix(API_PREFIX);
  // Bảo mật HTTP (TASK-155): header bảo mật, không lộ framework, lấy đúng IP người gọi khi chạy sau proxy.
  const config = app.get<AppConfig>(APP_CONFIG);
  const http = app.getHttpAdapter().getInstance() as {
    disable(name: string): void;
    set(name: string, value: unknown): void;
  };
  http.disable('x-powered-by');
  if (config.trustProxyHops > 0) {
    http.set('trust proxy', config.trustProxyHops);
  }
  app.use(securityHeaders(config.nodeEnv === 'production'));
  // Đóng kết nối gọn gàng khi container nhận SIGTERM.
  app.enableShutdownHooks();
  return app;
}
