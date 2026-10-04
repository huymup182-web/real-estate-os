import type { LogLevel } from '@nestjs/common';

import { LOG_LEVELS } from '../common/logging/app-logger.js';

/** Cấu hình chạy ứng dụng, đọc và kiểm tra từ biến môi trường (xem docs/environment.md). */
export const NODE_ENVS = ['development', 'production', 'test'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export interface AppConfig {
  port: number;
  nodeEnv: NodeEnv;
  databaseUrl: string;
  logLevel: LogLevel;
  jwtSecret: string;
  /** null khi chưa cấu hình SMTP (chỉ cho phép ngoài production): email không được gửi. */
  mail: MailConfig | null;
}

/** Máy chủ SMTP gửi email (mã đặt lại mật khẩu, TASK-042). */
export interface MailConfig {
  host: string;
  port: number;
  /** true: TLS ngay từ đầu (thường cổng 465); false: STARTTLS nếu máy chủ hỗ trợ. */
  secure: boolean;
  user: string | null;
  password: string | null;
  /** Địa chỉ người gửi, vd `"Real Estate OS" <no-reply@example.com>`. */
  from: string;
}

const DEFAULT_SMTP_PORT = 587;

const DEFAULT_PORT = 3000;

/** Độ dài tối thiểu của khoá ký JWT (docs/environment.md). */
export const JWT_SECRET_MIN_LENGTH = 32;

/** Khoá dev đã commit trong .env.development: không bao giờ được dùng ở production. */
const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret-change-me';

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

const DEFAULT_LOG_LEVEL: LogLevel = 'log';

function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/** Mức log từ LOG_LEVEL (mặc định `log`). Tách riêng để logger dùng được trước khi tạo ứng dụng. */
export function loadLogLevel(env: NodeJS.ProcessEnv = process.env): LogLevel {
  const logLevel = env['LOG_LEVEL'] ?? DEFAULT_LOG_LEVEL;
  if (!isLogLevel(logLevel)) {
    throw new Error(`LOG_LEVEL không hợp lệ: "${logLevel}" (cần ${LOG_LEVELS.join(' | ')})`);
  }
  return logLevel;
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

  const jwtSecret = env['JWT_SECRET'];
  if (!jwtSecret) {
    throw new Error('Thiếu JWT_SECRET (xem docs/environment.md)');
  }
  if (jwtSecret.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(`JWT_SECRET phải có ít nhất ${JWT_SECRET_MIN_LENGTH} ký tự`);
  }
  if (nodeEnv === 'production' && jwtSecret === DEV_JWT_SECRET) {
    throw new Error(
      'JWT_SECRET đang là khoá dev của .env.development, không dùng được ở production',
    );
  }

  return {
    port,
    nodeEnv,
    databaseUrl,
    logLevel: loadLogLevel(env),
    jwtSecret,
    mail: loadMailConfig(env, nodeEnv),
  };
}

/** SMTP bắt buộc ở production; môi trường khác thiếu SMTP_HOST thì không gửi email. */
function loadMailConfig(env: NodeJS.ProcessEnv, nodeEnv: NodeEnv): MailConfig | null {
  const host = env['SMTP_HOST'];
  if (!host) {
    if (nodeEnv === 'production') {
      throw new Error('Thiếu SMTP_HOST (xem docs/environment.md)');
    }
    return null;
  }

  const rawPort = env['SMTP_PORT'] ?? String(DEFAULT_SMTP_PORT);
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || port < 1 || port > 65535) {
    throw new Error(`SMTP_PORT không hợp lệ: "${rawPort}" (cần số nguyên 1–65535)`);
  }

  const rawSecure = env['SMTP_SECURE'] ?? 'false';
  if (rawSecure !== 'true' && rawSecure !== 'false') {
    throw new Error(`SMTP_SECURE không hợp lệ: "${rawSecure}" (cần true | false)`);
  }

  const user = env['SMTP_USER'] || null;
  const password = env['SMTP_PASSWORD'] || null;
  if ((user === null) !== (password === null)) {
    throw new Error('SMTP_USER và SMTP_PASSWORD phải cùng có hoặc cùng để trống');
  }

  const from = env['MAIL_FROM'];
  if (!from) {
    throw new Error('Thiếu MAIL_FROM (xem docs/environment.md)');
  }

  return { host, port, secure: rawSecure === 'true', user, password, from };
}
