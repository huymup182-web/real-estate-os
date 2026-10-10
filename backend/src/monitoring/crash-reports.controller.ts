import { Body, Controller, HttpCode, Logger, Post, Req } from '@nestjs/common';

import { AccessTokenService, type AuthenticatedUser } from '../auth/access-token.service.js';
import { type ClientRequest, clientInfoFrom } from '../auth/client-info.js';
import { Public } from '../auth/public.decorator.js';
import { getRequestContext } from '../common/logging/request-context.js';
import { RateLimiter } from '../common/rate-limit/rate-limiter.js';
import { CrashReportDto } from './crash-report.dto.js';
import { CRASH_REPORT_RATE_LIMITS as LIMITS, crashFingerprint } from './crash-report.js';
import { MetricsService } from './metrics.service.js';

/**
 * `POST /api/v1/crash-reports` → 204 (TASK-159, docs/crash-reporting.md): web quản trị và app di động gửi lỗi chưa
 * xử lý. Backend ghi một dòng log `error` kèm mã nhóm lỗi và đếm `crash_reports_total`; không lưu database.
 *
 * Công khai vì lỗi có thể xảy ra trước khi đăng nhập (màn đăng nhập). Có access token hợp lệ thì log kèm
 * tenantId/userId; token hết hạn hoặc sai thì coi như chưa đăng nhập, không trả 401.
 */
@Public()
@Controller('crash-reports')
export class CrashReportsController {
  private readonly logger = new Logger('CrashReport');

  constructor(
    private readonly accessTokens: AccessTokenService,
    private readonly limiter: RateLimiter,
    private readonly metrics: MetricsService,
  ) {}

  @Post()
  @HttpCode(204)
  async report(@Body() dto: CrashReportDto, @Req() req: ClientRequest): Promise<void> {
    const user = await this.optionalUser(req);
    if (user) {
      this.limiter.consume(LIMITS.perUser, user.userId);
      const context = getRequestContext();
      if (context) {
        context.userId = user.userId;
        context.tenantId = user.tenantId ?? undefined;
      }
    } else {
      this.limiter.consume(LIMITS.perIp, clientInfoFrom(req).ipAddress ?? 'unknown');
    }

    this.metrics.crashReported(dto.platform);
    this.logger.error(`Lỗi ứng dụng ${dto.platform}: ${dto.name}`, {
      platform: dto.platform,
      fingerprint: crashFingerprint(dto),
      errorName: dto.name,
      errorMessage: dto.message,
      fatal: dto.fatal ?? false,
      ...(dto.appVersion ? { appVersion: dto.appVersion } : {}),
      ...(dto.route ? { route: dto.route } : {}),
      ...(dto.digest ? { digest: dto.digest } : {}),
      ...(dto.stack ? { errorStack: dto.stack } : {}),
    });
  }

  private async optionalUser(req: ClientRequest): Promise<AuthenticatedUser | null> {
    const header = req.headers['authorization'];
    const token = typeof header === 'string' ? /^Bearer ([^\s]+)$/i.exec(header)?.[1] : undefined;
    if (!token) {
      return null;
    }
    try {
      return await this.accessTokens.verify(token);
    } catch {
      // Token hết hạn hoặc sai: vẫn nhận báo cáo, chỉ không gắn người dùng.
      return null;
    }
  }
}
