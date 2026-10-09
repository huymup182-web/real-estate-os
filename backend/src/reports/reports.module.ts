import { Module } from '@nestjs/common';

import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/** Module báo cáo: chỉ đọc và tổng hợp dữ liệu các module khác (phase0/02-ARCHITECTURE.md mục 2.1). */
@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
