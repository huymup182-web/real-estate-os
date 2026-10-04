import { Module } from '@nestjs/common';

import { CommonModule } from './common/common.module.js';
import { AppConfigModule } from './config/app-config.module.js';
import { DatabaseModule } from './database/database.module.js';

/**
 * Module gốc. Các module nghiệp vụ (auth, properties, customers…) được thêm vào `imports`
 * ở các task sau, theo ranh giới module trong phase0/02-ARCHITECTURE.md mục 2.1.
 */
@Module({
  imports: [AppConfigModule, DatabaseModule, CommonModule],
})
export class AppModule {}
