import type { ServerResponse } from 'node:http';

import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';

import { Paginated, type PaginationMeta } from './paginated.js';

/** Body thành công chuẩn (định dạng gộp đã chốt); `meta` chỉ có ở danh sách phân trang. */
export interface SuccessResponseBody<T = unknown> {
  success: true;
  data: T;
  message: null;
  meta?: PaginationMeta;
}

/**
 * Bọc kết quả controller thành `{ success: true, data, message: null }`.
 * Không bọc: response 204 (không có body) và file trả về dạng stream.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = context.switchToHttp().getResponse<ServerResponse>();
    return next.handle().pipe(
      map((result: unknown) => {
        if (res.statusCode === 204 || result instanceof StreamableFile) {
          return result;
        }
        if (result instanceof Paginated) {
          const body: SuccessResponseBody = {
            success: true,
            data: result.items,
            message: null,
            meta: result.meta,
          };
          return body;
        }
        const body: SuccessResponseBody = { success: true, data: result ?? null, message: null };
        return body;
      }),
    );
  }
}
