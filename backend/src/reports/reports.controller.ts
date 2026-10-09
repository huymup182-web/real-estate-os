import { Controller, Get, Query, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import { actorOf } from '../properties/properties.controller.js';
import { DashboardQueryDto } from './dto/dashboard-query.dto.js';
import { type Dashboard, ReportsService } from './reports.service.js';

/** Báo cáo, chỉ đọc (TASK-102). */
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** `GET /api/v1/reports/dashboard?from&to` → số liệu tổng và phễu trong phạm vi `report.view`. */
  @Get('dashboard')
  @RequirePermission('report.view')
  dashboard(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Query() query: DashboardQueryDto,
  ): Promise<Dashboard> {
    // Route đã có @RequirePermission nên user chắc chắn có scope của report.view.
    const scope = req.user.permissions['report.view'] ?? 'OWN';
    return this.reports.dashboard(actorOf(tenantId, req.user), query, scope);
  }
}
