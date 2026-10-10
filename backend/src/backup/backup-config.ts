import { resolve } from 'node:path';

import { isHttpUrl, isPostgresUrl } from '../config/app-config.js';

/** Kho lưu bản sao lưu ở nơi khác (S3 / Cloudflare R2 / MinIO), tách khỏi bucket ảnh và khoá của API. */
export interface BackupStorageConfig {
  endpoint: string | null;
  region: string;
  bucket: string;
  /** Tiền tố key, vd `database/`. */
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/** Cấu hình lệnh sao lưu (TASK-157, docs/backup.md). */
export interface BackupConfig {
  databaseUrl: string;
  /** Thư mục giữ bản sao lưu trên máy chạy lệnh. */
  dir: string;
  /** Số ngày giữ bản sao lưu trong `dir`; cũ hơn thì xoá. */
  keepDays: number;
  /** null: chỉ lưu trên máy (không cho phép ở production). */
  storage: BackupStorageConfig | null;
}

export const DEFAULT_BACKUP_DIR = 'backups';
export const DEFAULT_BACKUP_KEEP_DAYS = 7;
const MAX_BACKUP_KEEP_DAYS = 3650;

/** Ném lỗi ngay nếu biến môi trường sai, để lệnh sao lưu không chạy với cấu hình hỏng. */
export function loadBackupConfig(env: NodeJS.ProcessEnv = process.env): BackupConfig {
  const databaseUrl = env['DATABASE_URL'];
  if (!databaseUrl || !isPostgresUrl(databaseUrl)) {
    throw new Error(
      'Thiếu hoặc sai DATABASE_URL: cần dạng postgresql://USER:PASSWORD@HOST:PORT/DB',
    );
  }

  const rawKeep = env['BACKUP_KEEP_DAYS'] || String(DEFAULT_BACKUP_KEEP_DAYS);
  const keepDays = Number(rawKeep);
  if (!/^\d+$/.test(rawKeep) || keepDays < 1 || keepDays > MAX_BACKUP_KEEP_DAYS) {
    throw new Error(
      `BACKUP_KEEP_DAYS không hợp lệ: "${rawKeep}" (cần số nguyên 1–${MAX_BACKUP_KEEP_DAYS})`,
    );
  }

  const storage = loadBackupStorageConfig(env);
  if (!storage && env['NODE_ENV'] === 'production') {
    throw new Error('Thiếu BACKUP_BUCKET: production phải gửi bản sao lưu ra kho lưu trữ khác');
  }

  return {
    databaseUrl,
    dir: resolve(env['BACKUP_DIR'] || DEFAULT_BACKUP_DIR),
    keepDays,
    storage,
  };
}

function loadBackupStorageConfig(env: NodeJS.ProcessEnv): BackupStorageConfig | null {
  const bucket = env['BACKUP_BUCKET'];
  if (!bucket) {
    return null;
  }
  const accessKeyId = env['BACKUP_ACCESS_KEY_ID'];
  const secretAccessKey = env['BACKUP_SECRET_ACCESS_KEY'];
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Thiếu BACKUP_ACCESS_KEY_ID hoặc BACKUP_SECRET_ACCESS_KEY');
  }
  const endpoint = env['BACKUP_ENDPOINT'] || null;
  if (endpoint !== null && !isHttpUrl(endpoint)) {
    throw new Error(`BACKUP_ENDPOINT không hợp lệ: "${endpoint}" (cần http:// hoặc https://)`);
  }
  const rawPathStyle = env['BACKUP_FORCE_PATH_STYLE'] ?? 'false';
  if (rawPathStyle !== 'true' && rawPathStyle !== 'false') {
    throw new Error(`BACKUP_FORCE_PATH_STYLE không hợp lệ: "${rawPathStyle}" (cần true | false)`);
  }
  const prefix = (env['BACKUP_PREFIX'] ?? 'database/').replace(/^\/+/, '');
  return {
    endpoint,
    region: env['BACKUP_REGION'] || 'auto',
    bucket,
    prefix: prefix === '' || prefix.endsWith('/') ? prefix : `${prefix}/`,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: rawPathStyle === 'true',
  };
}
