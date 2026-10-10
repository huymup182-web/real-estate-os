import { Module } from '@nestjs/common';

import { PropertiesModule } from '../properties/properties.module.js';
import { MarketStatsService } from './market-stats.service.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/** Module báo cáo: chỉ đọc và tổng hợp dữ liệu các module khác (phase0/02-ARCHITECTURE.md mục 2.1). */
@Module({
  imports: [PropertiesModule],
  controllers: [ReportsController],
  providers: [ReportsService, MarketStatsService],
})
export class ReportsModule {}
