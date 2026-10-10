import { Controller, Get, Query, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import { actorOf, scopesOf } from '../properties/properties.controller.js';
import { DashboardQueryDto } from './dto/dashboard-query.dto.js';
import { MarketPriceQueryDto } from './dto/market-price-query.dto.js';
import {
  type MarketPricePerM2,
  type MarketPriceStats,
  MarketStatsService,
} from './market-stats.service.js';
import { type Dashboard, ReportsService } from './reports.service.js';

/** Báo cáo, chỉ đọc (TASK-102). */
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly market: MarketStatsService,
  ) {}

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

  /**
   * `GET /api/v1/reports/market/prices?provinceId&wardId&propertyType&groupBy&months` → thống kê giá thị trường
   * theo phường/xã hoặc loại BĐS (TASK-145). Cần `property.view`; chỉ tính BĐS trong phạm vi đó.
   */
  @Get('market/prices')
  @RequirePermission('property.view')
  marketPrices(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Query() query: MarketPriceQueryDto,
  ): Promise<MarketPriceStats> {
    return this.market.prices(actorOf(tenantId, req.user), query, scopesOf(req.user));
  }

  /**
   * `GET /api/v1/reports/market/price-per-m2?provinceId&wardId&propertyType&groupBy&months` → giá/m² theo
   * phường/xã hoặc loại BĐS, kèm xu hướng theo tháng (TASK-146). Cần `property.view`; cùng tập BĐS với
   * `market/prices`.
   */
  @Get('market/price-per-m2')
  @RequirePermission('property.view')
  marketPricePerM2(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Query() query: MarketPriceQueryDto,
  ): Promise<MarketPricePerM2> {
    return this.market.pricePerM2(actorOf(tenantId, req.user), query, scopesOf(req.user));
  }
}
