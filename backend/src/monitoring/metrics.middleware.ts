import type { IncomingMessage, ServerResponse } from 'node:http';

import { Injectable, type NestMiddleware } from '@nestjs/common';

import { MetricsService, UNMATCHED_ROUTE } from './metrics.service.js';

type RoutedRequest = IncomingMessage & { route?: { path?: unknown } };

/**
 * Đếm request và thời gian xử lý cho `GET /metrics` (TASK-158). Nhãn route là mẫu route Express đã khớp
 * (vd `/api/v1/properties/:id`), không phải URL thật, để số chuỗi nhãn không tăng theo id.
 */
@Injectable()
export class MetricsMiddleware implements NestMiddleware<IncomingMessage, ServerResponse> {
  constructor(private readonly metrics: MetricsService) {}

  use(req: RoutedRequest, res: ServerResponse, next: (error?: unknown) => void): void {
    const startedAt = process.hrtime.bigint();
    this.metrics.requestStarted();
    let done = false;
    const finish = (): void => {
      if (done) {
        return;
      }
      done = true;
      const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      const path = req.route?.path;
      // Route bắt mọi đường dẫn (`*path`) là chỗ Nest trả 404: tính là không khớp route nào.
      const route = typeof path === 'string' && !/^\/?\*/.test(path) ? path : UNMATCHED_ROUTE;
      this.metrics.requestFinished(req.method ?? '', route, res.statusCode, seconds);
    };
    // `close` cũng chạy khi người gọi ngắt kết nối giữa chừng, để số request đang xử lý không lệch.
    res.once('finish', finish);
    res.once('close', finish);
    next();
  }
}
