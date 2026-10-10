import { Controller, Get, Query, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import { actorOf, scopesOf } from '../properties/properties.controller.js';
import { DashboardQueryDto } from './dto/dashboard-query.dto.js';
import { MarketPriceQueryDto } from './dto/market-price-query.dto.js';
import { type Leaderboard, LeaderboardService } from './leaderboard.service.js';
import {
  type MarketLiquidity,
  type MarketPricePerM2,
  type MarketPriceStats,
  MarketStatsService,
} from './market-stats.service.js';
import { type Dashboard, ReportsService } from './reports.service.js';
import { type SalesAnalytics, SalesAnalyticsService } from './sales-analytics.service.js';

/** Báo cáo, chỉ đọc (TASK-102). */
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly market: MarketStatsService,
    private readonly leaderboards: LeaderboardService,
    private readonly salesAnalytics: SalesAnalyticsService,
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
   * `GET /api/v1/reports/leaderboard?from&to` → bảng xếp hạng môi giới trong phạm vi `report.view` (TASK-151): điểm,
   * tin đăng, chăm sóc khách, dẫn khách, giao dịch chốt, doanh số trong kỳ.
   */
  @Get('leaderboard')
  @RequirePermission('report.view')
  leaderboard(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Query() query: DashboardQueryDto,
  ): Promise<Leaderboard> {
    const scope = req.user.permissions['report.view'] ?? 'OWN';
    return this.leaderboards.leaderboard(actorOf(tenantId, req.user), query, scope);
  }

  /**
   * `GET /api/v1/reports/sales?from&to` → phân tích doanh số trong phạm vi `report.view` (TASK-152): doanh số, tỷ lệ
   * thắng, thời gian chốt, pipeline, xu hướng theo tháng, theo loại BĐS và khu vực.
   */
  @Get('sales')
  @RequirePermission('report.view')
  sales(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Query() query: DashboardQueryDto,
  ): Promise<SalesAnalytics> {
    const scope = req.user.permissions['report.view'] ?? 'OWN';
    return this.salesAnalytics.sales(actorOf(tenantId, req.user), query, scope);
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

  /**
   * `GET /api/v1/reports/market/liquidity?provinceId&wardId&propertyType&groupBy&months` → cung, số căn đã bán,
   * tỷ lệ bán được, mức thanh khoản, số ngày bán, lượt xem và dẫn khách mỗi tin (TASK-147). Cần `property.view`.
   */
  @Get('market/liquidity')
  @RequirePermission('property.view')
  marketLiquidity(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Query() query: MarketPriceQueryDto,
  ): Promise<MarketLiquidity> {
    return this.market.liquidity(actorOf(tenantId, req.user), query, scopesOf(req.user));
  }
}
