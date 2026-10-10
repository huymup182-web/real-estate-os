import { ConsoleLogger, type LogLevel } from '@nestjs/common';

import { getRequestContext } from './request-context.js';

/** Các mức log từ nghiêm trọng nhất đến chi tiết nhất. */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'] as const;

/** Tên trường bị che trong log (so khớp không phân biệt hoa thường, ở mọi độ sâu). */
export const REDACTED_FIELDS = [
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'secret',
];

/** Bật `level` và mọi mức nghiêm trọng hơn; vd `log` → fatal, error, warn, log. */
export function enabledLogLevels(level: LogLevel): LogLevel[] {
  return LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(level) + 1);
}

type JsonLogOptions = Parameters<ConsoleLogger['getJsonLogObject']>[1];

/**
 * Logger của ứng dụng: logger NestJS ở chế độ JSON, mỗi dòng log tự kèm `requestId`,
 * `tenantId`, `userId` của request đang xử lý (phase0/02-ARCHITECTURE.md).
 * Ghi thêm dữ liệu có cấu trúc bằng object sau câu log: `logger.log('Tạo BĐS', { propertyId })`.
 */
export class AppLogger extends ConsoleLogger {
  constructor(level: LogLevel) {
    super({
      json: true,
      logLevels: enabledLogLevels(level),
      flattenParams: true,
      redact: REDACTED_FIELDS,
    });
  }

  protected override getJsonLogObject(
    message: unknown,
    options: JsonLogOptions,
  ): ReturnType<ConsoleLogger['getJsonLogObject']> {
    const logObject = super.getJsonLogObject(message, options);
    const context = getRequestContext();
    if (context) {
      logObject['requestId'] = context.requestId;
      if (context.tenantId) {
        logObject['tenantId'] = context.tenantId;
      }
      if (context.userId) {
        logObject['userId'] = context.userId;
      }
    }
    return logObject;
  }
}
