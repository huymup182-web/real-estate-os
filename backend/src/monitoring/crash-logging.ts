import type { LoggerService } from '@nestjs/common';

/**
 * Ghi log `fatal` (JSON, kèm stack) khi backend sắp dừng vì lỗi không ai bắt: exception ném ra ngoài mọi handler
 * hoặc promise bị reject không có `catch` (TASK-159). Dùng `uncaughtExceptionMonitor` nên chỉ ghi log, Node vẫn dừng
 * tiến trình với exit code 1 như mặc định để hệ thống triển khai khởi động lại.
 */
export function logProcessCrashes(logger: LoggerService): void {
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    logger.fatal?.(error instanceof Error ? error : String(error), { origin });
  });
}
