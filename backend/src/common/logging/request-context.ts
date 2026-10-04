import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Thông tin của request đang xử lý, đọc được ở bất kỳ đâu trong cùng request (logger, service…).
 * `tenantId`/`userId` được gắn sau khi xác thực (TASK-047); trước đó chỉ có `requestId`.
 */
export interface RequestContext {
  requestId: string;
  tenantId?: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Chạy `callback` trong context của một request. */
export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return storage.run(context, callback);
}

/** Context của request hiện tại; `undefined` khi đang ở ngoài request (lúc khởi động, job nền…). */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
