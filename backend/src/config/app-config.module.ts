import { Global, Module } from '@nestjs/common';

import { loadAppConfig } from './app-config.js';

/** Token inject cấu hình ứng dụng (kiểu AppConfig). */
export const APP_CONFIG = Symbol('APP_CONFIG');

/** Đọc và kiểm tra biến môi trường một lần khi khởi động, dùng chung cho mọi module. */
@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadAppConfig() }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
