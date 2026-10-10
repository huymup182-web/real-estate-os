import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { Public } from '../auth/public.decorator.js';

/** Thời gian tối đa chờ database trả lời, để health check không treo khi database mất kết nối. */
export const DATABASE_CHECK_TIMEOUT_MS = 3000;

export interface HealthStatus {
  status: 'ok';
  db: 'up';
}

/** `true` nếu database trả lời `SELECT 1` trong thời gian cho phép. */
export async function isDatabaseUp(
  dataSource: { query(sql: string): Promise<unknown> },
  timeoutMs = DATABASE_CHECK_TIMEOUT_MS,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const query = dataSource.query('SELECT 1').then(
    () => true,
    () => false,
  );
  try {
    return await Promise.race([query, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `GET /api/v1/health`: không cần đăng nhập, không trả thông tin nhạy cảm (phase0/05-API-CONVENTIONS.md).
 * Database chạy → 200 `{ status: 'ok', db: 'up' }`; database không trả lời → 503.
 */
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  async check(): Promise<HealthStatus> {
    if (!(await isDatabaseUp(this.dataSource))) {
      throw new ServiceUnavailableException('Database không phản hồi');
    }
    return { status: 'ok', db: 'up' };
  }
}
