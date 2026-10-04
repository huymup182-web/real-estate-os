/** Cấu hình chạy ứng dụng, đọc và kiểm tra từ biến môi trường (xem docs/environment.md). */
export const NODE_ENVS = ['development', 'production', 'test'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export interface AppConfig {
  port: number;
  nodeEnv: NodeEnv;
}

const DEFAULT_PORT = 3000;

function isNodeEnv(value: string): value is NodeEnv {
  return (NODE_ENVS as readonly string[]).includes(value);
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

  return { port, nodeEnv };
}
