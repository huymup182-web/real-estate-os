import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import type { AppConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/app-config.module.js';

/**
 * Kết nối PostgreSQL qua TypeORM.
 * - Không dùng `synchronize` và không tự chạy migration: schema chỉ thay đổi qua migration
 *   trong thư mục database/ (`npm run migration:run`).
 * - Entity được đăng ký theo từng module nghiệp vụ (`TypeOrmModule.forFeature`), tự nạp vào kết nối.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        type: 'postgres',
        url: config.databaseUrl,
        synchronize: false,
        migrationsRun: false,
        autoLoadEntities: true,
        logging: ['error', 'warn'],
        retryAttempts: 5,
        retryDelay: 3000,
      }),
    }),
  ],
})
export class DatabaseModule {}
