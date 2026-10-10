import { timingSafeEqual } from 'node:crypto';

import { Controller, Get, Headers, Inject, StreamableFile } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { Public } from '../auth/public.decorator.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import type { AppConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/app-config.module.js';
import { isDatabaseUp } from '../health/health.controller.js';
import { type DatabaseStats, MetricsService } from './metrics.service.js';

interface PgPool {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * `GET /api/v1/metrics` (TASK-158): số liệu dạng text Prometheus cho hệ thống giám sát. Chỉ bật khi đặt
 * METRICS_TOKEN (không thì 404), gọi kèm `Authorization: Bearer <METRICS_TOKEN>`. Không có dữ liệu
 * nghiệp vụ hay dữ liệu cá nhân, chỉ số đếm theo route.
 */
@Public()
@Controller('metrics')
export class MetricsController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly metrics: MetricsService,
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  async scrape(@Headers('authorization') authorization?: string): Promise<StreamableFile> {
    const token = this.config.metricsToken;
    if (!token) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Không tìm thấy');
    }
    const given = /^Bearer (.+)$/.exec(authorization ?? '')?.[1] ?? '';
    if (!sameToken(given, token)) {
      throw new AppException(ErrorCode.UNAUTHENTICATED, 'Sai hoặc thiếu token metrics');
    }
    const text = this.metrics.render(await this.databaseStats());
    return new StreamableFile(Buffer.from(text, 'utf8'), {
      type: 'text/plain; version=0.0.4; charset=utf-8',
    });
  }

  private async databaseStats(): Promise<DatabaseStats> {
    const pool = (this.dataSource.driver as { master?: Partial<PgPool> }).master;
    return {
      up: await isDatabaseUp(this.dataSource),
      pool:
        pool && typeof pool.totalCount === 'number'
          ? {
              total: pool.totalCount,
              idle: pool.idleCount ?? 0,
              waiting: pool.waitingCount ?? 0,
            }
          : null,
    };
  }
}
