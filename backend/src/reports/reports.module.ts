import { Module } from '@nestjs/common';

import { PropertiesModule } from '../properties/properties.module.js';
import { ConversionAnalyticsService } from './conversion-analytics.service.js';
import { LeaderboardService } from './leaderboard.service.js';
import { MarketStatsService } from './market-stats.service.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { SalesAnalyticsService } from './sales-analytics.service.js';

/** Module báo cáo: chỉ đọc và tổng hợp dữ liệu các module khác (phase0/02-ARCHITECTURE.md mục 2.1). */
@Module({
  imports: [PropertiesModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    MarketStatsService,
    LeaderboardService,
    SalesAnalyticsService,
    ConversionAnalyticsService,
  ],
})
export class ReportsModule {}
