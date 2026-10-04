import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { Injectable, type NestMiddleware } from '@nestjs/common';

import { runWithRequestContext } from '../logging/request-context.js';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Chỉ nhận request id an toàn từ client (chữ, số, - _ . :), tối đa 100 ký tự; không thì tự sinh. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,100}$/;

const MAX_USER_AGENT = 500;

/** IP của kết nối; bỏ tiền tố IPv4-mapped (`::ffff:`) để lưu được vào cột `inet`. */
function clientIp(address: string | undefined): string | undefined {
  if (!address) {
    return undefined;
  }
  return address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
}

export type RequestWithId = IncomingMessage & { requestId?: string };

/** Lấy request id đã gắn; request chưa qua middleware (hiếm) thì sinh mới để vẫn có id trả về. */
export function getRequestId(req: RequestWithId): string {
  req.requestId ??= randomUUID();
  return req.requestId;
}

/**
 * Gắn request id cho mỗi request (header X-Request-Id), trả lại trong response để tra log,
 * và mở request context để mọi dòng log trong request tự kèm request id.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware<RequestWithId, ServerResponse> {
  use(req: RequestWithId, res: ServerResponse, next: (error?: unknown) => void): void {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const requestId =
      typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    const userAgent = req.headers['user-agent'];
    runWithRequestContext(
      {
        requestId,
        ipAddress: clientIp(req.socket.remoteAddress),
        userAgent: typeof userAgent === 'string' ? userAgent.slice(0, MAX_USER_AGENT) : undefined,
      },
      () => next(),
    );
  }
}
