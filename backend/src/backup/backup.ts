import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { DataSource } from 'typeorm';

import type { BackupConfig, BackupStorageConfig } from './backup-config.js';

/** Một bản sao lưu database: file định dạng custom của pg_dump (nén sẵn). */
export interface BackupFile {
  path: string;
  name: string;
  sizeBytes: number;
  sha256: string;
  createdAt: Date;
}

/** Kết quả diễn tập khôi phục. */
export interface RestoreCheck {
  database: string;
  tables: number;
  lastMigration: string | null;
  rows: Record<string, number>;
}

/** `<database>-<YYYYMMDDTHHmmssZ>.dump`, giờ UTC. */
const NAME_PATTERN = /^(.+)-(\d{8}T\d{6}Z)\.dump$/;
/** Tên database đích khi khôi phục: chữ thường, số, gạch dưới. */
const DATABASE_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
/** Hậu tố database tạm của lệnh diễn tập; chỉ lệnh diễn tập tạo và xoá database có hậu tố này. */
export const RESTORE_CHECK_SUFFIX = '_restore_check';

export function backupFileName(database: string, at: Date): string {
  const stamp = at
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
  return `${database}-${stamp}.dump`;
}

/** Thời điểm tạo ghi trong tên file, hoặc null nếu file không phải bản sao lưu. */
export function backupTime(name: string): Date | null {
  const stamp = NAME_PATTERN.exec(name)?.[2];
  if (!stamp) {
    return null;
  }
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
  return new Date(iso);
}

/** Tên database trong DATABASE_URL. */
export function databaseName(databaseUrl: string): string {
  return decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
}

function withDatabase(databaseUrl: string, database: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.toString();
}

/**
 * Kết nối cho pg_dump/pg_restore qua biến môi trường PG*, để mật khẩu không nằm trong danh sách tiến trình
 * (`ps`) như khi truyền cả URL vào tham số dòng lệnh.
 */
function pgEnv(databaseUrl: string): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl);
  const sslMode = url.searchParams.get('sslmode');
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: databaseName(databaseUrl),
    ...(sslMode ? { PGSSLMODE: sslMode } : {}),
  };
}

/** Chạy lệnh, trả stdout; lỗi thì ném kèm stderr. */
function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8'));
      } else {
        const message = Buffer.concat(stderr).toString('utf8').trim();
        reject(new Error(`${command} lỗi (exit ${code}): ${message}`));
      }
    });
  });
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/** Kiểm file đọc được bằng pg_restore và có dữ liệu bảng; trả số mục TABLE DATA. */
export async function verifyArchive(path: string): Promise<number> {
  const list = await run('pg_restore', ['--list', path], process.env);
  const tables = list.split('\n').filter((line) => line.includes(' TABLE DATA ')).length;
  if (tables === 0) {
    throw new Error(`${basename(path)} không có dữ liệu bảng nào`);
  }
  return tables;
}

async function describe(path: string): Promise<BackupFile> {
  const name = basename(path);
  const info = await stat(path);
  return {
    path,
    name,
    sizeBytes: info.size,
    sha256: await sha256(path),
    createdAt: backupTime(name) ?? info.mtime,
  };
}

/**
 * Sao lưu toàn bộ database bằng pg_dump (định dạng custom, nén) vào `config.dir`. Ghi ra file tạm rồi mới đổi
 * tên sau khi pg_restore đọc lại được, nên file `.dump` trong thư mục luôn là bản hoàn chỉnh.
 */
export async function createBackup(config: BackupConfig, now = new Date()): Promise<BackupFile> {
  await mkdir(config.dir, { recursive: true });
  const name = backupFileName(databaseName(config.databaseUrl), now);
  const finalPath = join(config.dir, name);
  const partialPath = `${finalPath}.partial`;
  try {
    await run(
      'pg_dump',
      ['--format=custom', '--no-owner', '--no-privileges', `--file=${partialPath}`],
      pgEnv(config.databaseUrl),
    );
    await verifyArchive(partialPath);
    await rename(partialPath, finalPath);
  } catch (error) {
    await rm(partialPath, { force: true });
    throw error;
  }
  return describe(finalPath);
}

function s3Client(storage: BackupStorageConfig): S3Client {
  return new S3Client({
    region: storage.region,
    ...(storage.endpoint ? { endpoint: storage.endpoint } : {}),
    forcePathStyle: storage.forcePathStyle,
    credentials: { accessKeyId: storage.accessKeyId, secretAccessKey: storage.secretAccessKey },
    // Không gửi checksum CRC kiểu aws-chunked mà một số kho S3-compatible chưa hỗ trợ; đã có SHA-256 riêng.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

/**
 * Gửi bản sao lưu lên kho lưu trữ, kèm SHA-256 trong metadata. Một lần PUT (tối đa 5 GB với S3). Thời gian
 * giữ trên kho đặt bằng lifecycle rule của bucket, để khoá dùng cho sao lưu chỉ cần quyền ghi, không cần quyền xoá.
 */
export async function uploadBackup(
  storage: BackupStorageConfig,
  file: BackupFile,
): Promise<string> {
  const key = `${storage.prefix}${file.name}`;
  await s3Client(storage).send(
    new PutObjectCommand({
      Bucket: storage.bucket,
      Key: key,
      Body: createReadStream(file.path),
      ContentLength: file.sizeBytes,
      ContentType: 'application/octet-stream',
      Metadata: { sha256: file.sha256 },
    }),
  );
  return key;
}

/** Tải bản sao lưu `name` từ kho lưu trữ về `dir`. */
export async function downloadBackup(
  storage: BackupStorageConfig,
  name: string,
  dir: string,
): Promise<string> {
  if (!backupTime(name)) {
    throw new Error(`Tên bản sao lưu không hợp lệ: "${name}"`);
  }
  await mkdir(dir, { recursive: true });
  const result = await s3Client(storage).send(
    new GetObjectCommand({ Bucket: storage.bucket, Key: `${storage.prefix}${name}` }),
  );
  const path = join(dir, name);
  const partialPath = `${path}.partial`;
  await pipeline(result.Body as Readable, createWriteStream(partialPath));
  const expected = result.Metadata?.['sha256'];
  if (expected && (await sha256(partialPath)) !== expected) {
    await rm(partialPath, { force: true });
    throw new Error(`${name}: SHA-256 không khớp, file tải về bị hỏng`);
  }
  await rename(partialPath, path);
  return path;
}

/** Bản sao lưu trong `dir`, mới nhất trước. */
export async function listLocalBackups(dir: string): Promise<{ name: string; createdAt: Date }[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  return names
    .map((name) => ({ name, createdAt: backupTime(name) }))
    .filter((item): item is { name: string; createdAt: Date } => item.createdAt !== null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Bản sao lưu trên kho lưu trữ, mới nhất trước. */
export async function listRemoteBackups(
  storage: BackupStorageConfig,
): Promise<{ name: string; sizeBytes: number }[]> {
  const client = s3Client(storage);
  const items: { name: string; sizeBytes: number; createdAt: Date }[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: storage.bucket,
        Prefix: storage.prefix,
        ContinuationToken: token,
      }),
    );
    for (const object of page.Contents ?? []) {
      const name = (object.Key ?? '').slice(storage.prefix.length);
      const createdAt = backupTime(name);
      if (createdAt) {
        items.push({ name, sizeBytes: object.Size ?? 0, createdAt });
      }
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return items
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(({ name, sizeBytes }) => ({ name, sizeBytes }));
}

/**
 * Xoá bản sao lưu trong `dir` cũ hơn `keepDays` ngày (theo thời điểm ghi trong tên file). Luôn giữ bản mới
 * nhất, để lệnh sao lưu ngừng chạy một thời gian cũng không xoá hết. Chỉ đụng tới file đúng mẫu tên.
 */
export async function pruneLocalBackups(
  dir: string,
  keepDays: number,
  now = new Date(),
): Promise<string[]> {
  const cutoff = now.getTime() - keepDays * 86_400_000;
  const [, ...older] = await listLocalBackups(dir);
  const expired = older.filter((item) => item.createdAt.getTime() < cutoff);
  for (const item of expired) {
    await rm(join(dir, item.name));
  }
  return expired.map((item) => item.name);
}

async function withConnection<T>(
  databaseUrl: string,
  work: (db: DataSource) => Promise<T>,
): Promise<T> {
  const db = new DataSource({ type: 'postgres', url: databaseUrl });
  await db.initialize();
  try {
    return await work(db);
  } finally {
    await db.destroy();
  }
}

async function databaseExists(db: DataSource, name: string): Promise<boolean> {
  const rows: unknown[] = await db.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  return rows.length > 0;
}

/**
 * Khôi phục `path` vào database MỚI `target` trên cùng máy chủ với DATABASE_URL. Không bao giờ ghi đè: database
 * đã có thì dừng. Khôi phục lỗi giữa chừng thì xoá database vừa tạo. Sau khi kiểm dữ liệu, trỏ DATABASE_URL
 * của ứng dụng sang database mới (docs/backup.md).
 */
export async function restoreBackup(
  config: BackupConfig,
  path: string,
  target: string,
): Promise<void> {
  if (!DATABASE_NAME_PATTERN.test(target)) {
    throw new Error(`Tên database đích không hợp lệ: "${target}" (chữ thường, số, gạch dưới)`);
  }
  await verifyArchive(path);
  await withConnection(config.databaseUrl, async (db) => {
    if (await databaseExists(db, target)) {
      throw new Error(`Database "${target}" đã có: khôi phục chỉ vào database mới, không ghi đè`);
    }
    await db.query(`CREATE DATABASE "${target}"`);
  });
  try {
    await run(
      'pg_restore',
      ['--no-owner', '--no-privileges', '--exit-on-error', `--dbname=${target}`, path],
      pgEnv(withDatabase(config.databaseUrl, target)),
    );
  } catch (error) {
    await withConnection(config.databaseUrl, (db) => db.query(`DROP DATABASE "${target}"`));
    throw error;
  }
}

/** Số bảng, migration cuối và số dòng từng bảng của database `name`. */
export async function inspectDatabase(
  databaseUrl: string,
): Promise<Omit<RestoreCheck, 'database'>> {
  return withConnection(databaseUrl, async (db) => {
    const tables = (
      (await db.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'spatial_ref_sys'
          ORDER BY tablename`,
      )) as { tablename: string }[]
    ).map((row) => row.tablename);
    const rows: Record<string, number> = {};
    for (const table of tables) {
      const [count] = (await db.query(`SELECT count(*)::int AS n FROM "${table}"`)) as {
        n: number;
      }[];
      rows[table] = count?.n ?? 0;
    }
    const [last] = tables.includes('migrations')
      ? ((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1')) as {
          name: string;
        }[])
      : [];
    return { tables: tables.length, lastMigration: last?.name ?? null, rows };
  });
}

/**
 * Diễn tập khôi phục: khôi phục `path` vào database tạm `<database>_restore_check`, đếm bảng và dòng, rồi xoá
 * database tạm. Database tạm còn sót từ lần diễn tập trước bị xoá trước khi chạy.
 */
export async function checkRestore(config: BackupConfig, path: string): Promise<RestoreCheck> {
  const target = `${databaseName(config.databaseUrl)}${RESTORE_CHECK_SUFFIX}`;
  await dropRestoreCheck(config, target);
  await restoreBackup(config, path, target);
  try {
    const result = await inspectDatabase(withDatabase(config.databaseUrl, target));
    if (result.tables === 0 || result.lastMigration === null) {
      throw new Error('Database khôi phục không có bảng hoặc không có migration nào');
    }
    return { database: target, ...result };
  } finally {
    await dropRestoreCheck(config, target);
  }
}

async function dropRestoreCheck(config: BackupConfig, target: string): Promise<void> {
  if (!target.endsWith(RESTORE_CHECK_SUFFIX)) {
    throw new Error(`Chỉ xoá database diễn tập (*${RESTORE_CHECK_SUFFIX})`);
  }
  await withConnection(config.databaseUrl, (db) =>
    db.query(`DROP DATABASE IF EXISTS "${target}" WITH (FORCE)`),
  );
}
