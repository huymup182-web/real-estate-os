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
  /**
   * Số proxy tin cậy đứng trước backend (load balancer, reverse proxy), 0 = không có (TASK-155). Dùng để lấy đúng
   * IP người gọi từ `X-Forwarded-For` cho giới hạn số lần gọi và nhật ký phiên đăng nhập.
   */
  trustProxyHops: number;
  /** null khi chưa cấu hình SMTP (chỉ cho phép ngoài production): email không được gửi. */
  mail: MailConfig | null;
  /** null khi chưa cấu hình object storage (chỉ cho phép ngoài production): không upload ảnh được. */
  storage: StorageConfig | null;
  /** null khi chưa đặt FCM_CONFIG: thông báo chỉ lưu hộp thư, không đẩy tới thiết bị. */
  fcm: FcmConfig | null;
  /** null khi chưa đặt AI_API_KEY: các tính năng AI tắt, API AI trả 503. */
  ai: AiConfig | null;
}

/** Nhà cung cấp LLM gateway hỗ trợ (TASK-133). Thêm nhà cung cấp = thêm adapter `LlmProvider`. */
export const AI_PROVIDERS = ['anthropic'] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

/** LLM mà AI gateway của backend gọi tới (TASK-133). */
export interface AiConfig {
  provider: AiProviderName;
  /** Khoá API nhà cung cấp LLM. Là secret, không bao giờ ghi log hay trả cho client. */
  apiKey: string;
  model: string;
  /** Gốc URL API của nhà cung cấp; đổi được để đi qua proxy hoặc test với máy chủ giả. */
  baseUrl: string;
  timeoutMs: number;
  /** Số lượt gọi AI tối đa của một người trong 24 giờ gần nhất. */
  userDailyLimit: number;
}

const DEFAULT_AI_PROVIDER: AiProviderName = 'anthropic';
const DEFAULT_AI_MODELS: Readonly<Record<AiProviderName, string>> = {
  anthropic: 'claude-opus-5-5',
};
const DEFAULT_AI_BASE_URLS: Readonly<Record<AiProviderName, string>> = {
  anthropic: 'https://api.anthropic.com',
};
const DEFAULT_AI_TIMEOUT_MS = 60_000;
const DEFAULT_AI_USER_DAILY_LIMIT = 100;

/** Service account Firebase dùng gọi FCM HTTP v1 (TASK-093). */
export interface FcmConfig {
  projectId: string;
  clientEmail: string;
  /** Khoá riêng PEM của service account. Là secret, không bao giờ ghi log. */
  privateKey: string;
  /** Địa chỉ đổi JWT lấy access token OAuth2. */
  tokenUri: string;
}

const DEFAULT_FCM_TOKEN_URI = 'https://oauth2.googleapis.com/token';

/** Object storage S3 / Cloudflare R2 / MinIO lưu ảnh BĐS (TASK-057). */
export interface StorageConfig {
  /** Endpoint S3-compatible (R2, MinIO); null = AWS S3 theo region. */
  endpoint: string | null;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** true với MinIO: URL dạng endpoint/bucket/key thay vì bucket.endpoint/key. */
  forcePathStyle: boolean;
  /** Địa chỉ CDN/public đọc ảnh, vd https://cdn.example.com; null = cấp link đọc có hạn. */
  publicUrl: string | null;
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
/** Số proxy tin cậy tối đa trong TRUST_PROXY_HOPS. */
export const MAX_TRUST_PROXY_HOPS = 5;

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

  const rawHops = env['TRUST_PROXY_HOPS'] ?? '0';
  const trustProxyHops = Number(rawHops);
  if (!/^\d+$/.test(rawHops) || trustProxyHops > MAX_TRUST_PROXY_HOPS) {
    throw new Error(
      `TRUST_PROXY_HOPS không hợp lệ: "${rawHops}" (cần số nguyên 0–${MAX_TRUST_PROXY_HOPS})`,
    );
  }

  return {
    port,
    nodeEnv,
    databaseUrl,
    logLevel: loadLogLevel(env),
    jwtSecret,
    trustProxyHops,
    mail: loadMailConfig(env, nodeEnv),
    storage: loadStorageConfig(env, nodeEnv),
    fcm: loadFcmConfig(env),
    ai: loadAiConfig(env),
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

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Object storage bắt buộc ở production; môi trường khác thiếu STORAGE_BUCKET thì không upload ảnh. */
function loadStorageConfig(env: NodeJS.ProcessEnv, nodeEnv: NodeEnv): StorageConfig | null {
  const bucket = env['STORAGE_BUCKET'];
  if (!bucket) {
    if (nodeEnv === 'production') {
      throw new Error('Thiếu STORAGE_BUCKET (xem docs/environment.md)');
    }
    return null;
  }

  const accessKeyId = env['STORAGE_ACCESS_KEY_ID'];
  const secretAccessKey = env['STORAGE_SECRET_ACCESS_KEY'];
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Thiếu STORAGE_ACCESS_KEY_ID hoặc STORAGE_SECRET_ACCESS_KEY');
  }

  const endpoint = env['STORAGE_ENDPOINT'] || null;
  if (endpoint !== null && !isHttpUrl(endpoint)) {
    throw new Error(`STORAGE_ENDPOINT không hợp lệ: "${endpoint}" (cần http:// hoặc https://)`);
  }
  const publicUrl = env['STORAGE_PUBLIC_URL'] || null;
  if (publicUrl !== null && !isHttpUrl(publicUrl)) {
    throw new Error(`STORAGE_PUBLIC_URL không hợp lệ: "${publicUrl}" (cần http:// hoặc https://)`);
  }

  const rawPathStyle = env['STORAGE_FORCE_PATH_STYLE'] ?? 'false';
  if (rawPathStyle !== 'true' && rawPathStyle !== 'false') {
    throw new Error(`STORAGE_FORCE_PATH_STYLE không hợp lệ: "${rawPathStyle}" (cần true | false)`);
  }

  return {
    endpoint,
    region: env['STORAGE_REGION'] || 'auto',
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: rawPathStyle === 'true',
    publicUrl: publicUrl?.replace(/\/+$/, '') ?? null,
  };
}

/**
 * FCM_CONFIG là file JSON service account Firebase mã hoá base64. Không bắt buộc ở môi trường nào: để trống
 * thì không đẩy thông báo; đặt mà sai thì dừng ngay khi khởi động.
 */
function loadFcmConfig(env: NodeJS.ProcessEnv): FcmConfig | null {
  const raw = env['FCM_CONFIG'];
  if (!raw) {
    return null;
  }

  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    throw new Error('FCM_CONFIG không hợp lệ: cần JSON service account Firebase mã hoá base64');
  }
  const account = (typeof json === 'object' && json !== null ? json : {}) as Record<
    string,
    unknown
  >;
  const field = (name: string): string | null => {
    const value = account[name];
    return typeof value === 'string' && value.trim() !== '' ? value : null;
  };

  const projectId = field('project_id');
  const clientEmail = field('client_email');
  const privateKey = field('private_key');
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('FCM_CONFIG thiếu project_id, client_email hoặc private_key');
  }
  if (!privateKey.includes('PRIVATE KEY')) {
    throw new Error('FCM_CONFIG: private_key không phải khoá PEM');
  }
  const tokenUri = field('token_uri') ?? DEFAULT_FCM_TOKEN_URI;
  if (!isHttpUrl(tokenUri)) {
    throw new Error(`FCM_CONFIG: token_uri không hợp lệ: "${tokenUri}"`);
  }

  return { projectId, clientEmail, privateKey, tokenUri };
}

function isAiProvider(value: string): value is AiProviderName {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number, max: number): number {
  const raw = env[name] || String(fallback);
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < 1 || value > max) {
    throw new Error(`${name} không hợp lệ: "${raw}" (cần số nguyên 1–${max})`);
  }
  return value;
}

/** AI không bắt buộc ở môi trường nào: để trống AI_API_KEY thì tắt AI; đặt mà cấu hình sai thì dừng ngay. */
function loadAiConfig(env: NodeJS.ProcessEnv): AiConfig | null {
  const apiKey = env['AI_API_KEY']?.trim();
  if (!apiKey) {
    return null;
  }

  const provider = env['AI_PROVIDER'] || DEFAULT_AI_PROVIDER;
  if (!isAiProvider(provider)) {
    throw new Error(`AI_PROVIDER không hợp lệ: "${provider}" (cần ${AI_PROVIDERS.join(' | ')})`);
  }

  const model = env['AI_MODEL']?.trim() || DEFAULT_AI_MODELS[provider];
  const baseUrl = env['AI_BASE_URL'] || DEFAULT_AI_BASE_URLS[provider];
  if (!isHttpUrl(baseUrl)) {
    throw new Error(`AI_BASE_URL không hợp lệ: "${baseUrl}" (cần http:// hoặc https://)`);
  }

  return {
    provider,
    apiKey,
    model,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    timeoutMs: positiveInt(env, 'AI_TIMEOUT_MS', DEFAULT_AI_TIMEOUT_MS, 600_000),
    userDailyLimit: positiveInt(env, 'AI_USER_DAILY_LIMIT', DEFAULT_AI_USER_DAILY_LIMIT, 100_000),
  };
}
