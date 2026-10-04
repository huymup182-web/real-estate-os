import type { IncomingMessage, ServerResponse } from 'node:http';

import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';

/** Đường dẫn gốc của request, bỏ query string. Express đổi `req.url` trong middleware nên ưu tiên `originalUrl`. */
export function requestPath(req: IncomingMessage & { originalUrl?: string }): string {
  return (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
}

/**
 * Ghi một dòng log khi mỗi request kết thúc: method, đường dẫn, status, thời gian xử lý.
 * Không ghi query string, header hay body (có thể chứa dữ liệu cá nhân, token).
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware<IncomingMessage, ServerResponse> {
  private readonly logger = new Logger('HTTP');

  use(req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void): void {
    const startedAt = process.hrtime.bigint();
    const method = req.method ?? '';
    const path = requestPath(req);
    res.once('finish', () => {
      const durationMs = Number((process.hrtime.bigint() - startedAt) / 1000n) / 1000;
      this.logger.log(`${method} ${path} ${res.statusCode}`, {
        method,
        path,
        statusCode: res.statusCode,
        durationMs,
      });
    });
    next();
  }
}
