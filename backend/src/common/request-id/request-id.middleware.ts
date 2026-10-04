import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { Injectable, type NestMiddleware } from '@nestjs/common';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Chỉ nhận request id an toàn từ client (chữ, số, - _ . :), tối đa 100 ký tự; không thì tự sinh. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,100}$/;

export type RequestWithId = IncomingMessage & { requestId?: string };

/** Lấy request id đã gắn; request chưa qua middleware (hiếm) thì sinh mới để vẫn có id trả về. */
export function getRequestId(req: RequestWithId): string {
  req.requestId ??= randomUUID();
  return req.requestId;
}

/** Gắn request id cho mỗi request (header X-Request-Id), trả lại trong response để tra log. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware<RequestWithId, ServerResponse> {
  use(req: RequestWithId, res: ServerResponse, next: (error?: unknown) => void): void {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const requestId =
      typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}
