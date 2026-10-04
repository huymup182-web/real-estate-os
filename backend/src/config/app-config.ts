/** Cấu hình chạy ứng dụng, đọc và kiểm tra từ biến môi trường (xem docs/environment.md). */
export const NODE_ENVS = ['development', 'production', 'test'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export interface AppConfig {
  port: number;
  nodeEnv: NodeEnv;
  databaseUrl: string;
}

const DEFAULT_PORT = 3000;

function isNodeEnv(value: string): value is NodeEnv {
  return (NODE_ENVS as readonly string[]).includes(value);
}

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'postgresql:' || url.protocol === 'postgres:') &&
      url.hostname !== '' &&
      url.pathname.length > 1
    );
  } catch {
    return false;
  }
}

/** Ném lỗi ngay khi khởi động nếu biến môi trường sai, thay vì chạy với cấu hình hỏng. */
export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawPort = env['PORT'] ?? String(DEFAULT_PORT);
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || port < 1 || port > 65535) {
    throw new Error(`PORT không hợp lệ: "${rawPort}" (cần số nguyên 1–65535)`);
  }

  const nodeEnv = env['NODE_ENV'] ?? 'development';
  if (!isNodeEnv(nodeEnv)) {
    throw new Error(`NODE_ENV không hợp lệ: "${nodeEnv}" (cần ${NODE_ENVS.join(' | ')})`);
  }

  const databaseUrl = env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('Thiếu DATABASE_URL (xem docs/environment.md)');
  }
  if (!isPostgresUrl(databaseUrl)) {
    throw new Error('DATABASE_URL không hợp lệ: cần dạng postgresql://USER:PASSWORD@HOST:PORT/DB');
  }

  return { port, nodeEnv, databaseUrl };
}
