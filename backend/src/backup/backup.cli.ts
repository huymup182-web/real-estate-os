import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { type BackupConfig, loadBackupConfig } from './backup-config.js';
import {
  checkRestore,
  createBackup,
  downloadBackup,
  listLocalBackups,
  listRemoteBackups,
  pruneLocalBackups,
  restoreBackup,
  uploadBackup,
} from './backup.js';

/**
 * Lệnh sao lưu database (TASK-157, docs/backup.md). Chạy từ thư mục backend sau `npm run build`:
 *   node dist/backup/backup.cli.js create              sao lưu, gửi lên kho lưu trữ, xoá bản cũ trên máy
 *   node dist/backup/backup.cli.js list                liệt kê bản sao lưu trên máy và trên kho
 *   node dist/backup/backup.cli.js check [tên]         diễn tập khôi phục (mặc định bản mới nhất trên máy)
 *   node dist/backup/backup.cli.js restore <tên> <db>  khôi phục vào database mới <db>
 * <tên> là đường dẫn file hoặc tên bản sao lưu; không có trên máy thì tải từ kho lưu trữ.
 */
const USAGE = 'Cách dùng: backup.cli.js create | list | check [tên] | restore <tên> <database mới>';

function log(message: string, data: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), message, ...data })}\n`);
}

async function locate(config: BackupConfig, nameOrPath: string | undefined): Promise<string> {
  if (!nameOrPath) {
    const [latest] = await listLocalBackups(config.dir);
    if (!latest) {
      throw new Error(`Chưa có bản sao lưu nào trong ${config.dir}`);
    }
    return join(config.dir, latest.name);
  }
  if (existsSync(nameOrPath)) {
    return nameOrPath;
  }
  const local = join(config.dir, nameOrPath);
  if (existsSync(local)) {
    return local;
  }
  if (!config.storage) {
    throw new Error(`Không tìm thấy ${nameOrPath} trên máy và chưa cấu hình BACKUP_BUCKET`);
  }
  log('Tải bản sao lưu từ kho lưu trữ', { name: nameOrPath });
  return downloadBackup(config.storage, nameOrPath, config.dir);
}

/** Báo dịch vụ giám sát là đã sao lưu xong. Gọi lỗi chỉ ghi log: bản sao lưu đã có, không tính là lỗi. */
async function sendHeartbeat(url: string): Promise<void> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      log('Gọi heartbeat sao lưu không thành công', { status: response.status });
    }
  } catch (error) {
    log('Gọi heartbeat sao lưu lỗi', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  const config = loadBackupConfig();
  switch (command) {
    case 'create': {
      const started = Date.now();
      const file = await createBackup(config);
      log('Đã sao lưu database', {
        name: file.name,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        seconds: Math.round((Date.now() - started) / 1000),
      });
      if (config.storage) {
        const key = await uploadBackup(config.storage, file);
        log('Đã gửi bản sao lưu lên kho lưu trữ', { bucket: config.storage.bucket, key });
      }
      const removed = await pruneLocalBackups(config.dir, config.keepDays);
      if (removed.length > 0) {
        log('Đã xoá bản sao lưu cũ trên máy', { keepDays: config.keepDays, removed });
      }
      if (config.heartbeatUrl) {
        await sendHeartbeat(config.heartbeatUrl);
      }
      return;
    }
    case 'list': {
      log('Bản sao lưu trên máy', {
        dir: config.dir,
        backups: (await listLocalBackups(config.dir)).map((item) => item.name),
      });
      if (config.storage) {
        log('Bản sao lưu trên kho lưu trữ', {
          bucket: config.storage.bucket,
          backups: await listRemoteBackups(config.storage),
        });
      }
      return;
    }
    case 'check': {
      const path = await locate(config, args[0]);
      const result = await checkRestore(config, path);
      log('Diễn tập khôi phục thành công', { file: path, ...result });
      return;
    }
    case 'restore': {
      const [nameOrPath, target] = args;
      if (!nameOrPath || !target) {
        throw new Error(USAGE);
      }
      const path = await locate(config, nameOrPath);
      await restoreBackup(config, path, target);
      log('Đã khôi phục vào database mới', { file: path, database: target });
      return;
    }
    default:
      throw new Error(USAGE);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  log('Sao lưu lỗi', { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
