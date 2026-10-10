import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { DataSource } from 'typeorm';

import { type BackupConfig, loadBackupConfig } from '../src/backup/backup-config.js';
import {
  backupFileName,
  backupTime,
  checkRestore,
  createBackup,
  databaseName,
  downloadBackup,
  inspectDatabase,
  listLocalBackups,
  pruneLocalBackups,
  restoreBackup,
  uploadBackup,
  verifyArchive,
} from '../src/backup/backup.js';
import { prepareTestDatabase } from './support/test-database.js';

const URL_OK = 'postgresql://u:p@localhost:5432/real_estate_os';
const BUCKET_ENV = {
  BACKUP_BUCKET: 'sao-luu',
  BACKUP_ACCESS_KEY_ID: 'access',
  BACKUP_SECRET_ACCESS_KEY: 'secret',
};

describe('TASK-157: cấu hình sao lưu', () => {
  it('mặc định giữ 7 ngày trong ./backups, không gửi đi đâu', () => {
    const config = loadBackupConfig({ DATABASE_URL: URL_OK });
    assert.equal(config.keepDays, 7);
    assert.equal(config.dir, join(process.cwd(), 'backups'));
    assert.equal(config.storage, null);
  });

  it('kho lưu trữ dùng khoá riêng BACKUP_*, tiền tố luôn kết thúc bằng /', () => {
    const config = loadBackupConfig({
      DATABASE_URL: URL_OK,
      ...BUCKET_ENV,
      BACKUP_PREFIX: '/prod/db',
      BACKUP_ENDPOINT: 'https://r2.example.com',
      BACKUP_KEEP_DAYS: '30',
    });
    assert.equal(config.keepDays, 30);
    assert.deepEqual(config.storage, {
      endpoint: 'https://r2.example.com',
      region: 'auto',
      bucket: 'sao-luu',
      prefix: 'prod/db/',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      forcePathStyle: false,
    });
    assert.equal(
      loadBackupConfig({ DATABASE_URL: URL_OK, ...BUCKET_ENV }).storage?.prefix,
      'database/',
    );
  });

  it('sai cấu hình thì dừng ngay; production bắt buộc có kho lưu trữ', () => {
    assert.throws(() => loadBackupConfig({}), /DATABASE_URL/);
    assert.throws(() => loadBackupConfig({ DATABASE_URL: 'mysql://x' }), /DATABASE_URL/);
    for (const value of ['0', '-1', 'abc', '3651']) {
      assert.throws(
        () => loadBackupConfig({ DATABASE_URL: URL_OK, BACKUP_KEEP_DAYS: value }),
        /BACKUP_KEEP_DAYS/,
      );
    }
    assert.throws(
      () => loadBackupConfig({ DATABASE_URL: URL_OK, BACKUP_BUCKET: 'sao-luu' }),
      /BACKUP_ACCESS_KEY_ID/,
    );
    assert.throws(
      () => loadBackupConfig({ DATABASE_URL: URL_OK, ...BUCKET_ENV, BACKUP_ENDPOINT: 'ftp://x' }),
      /BACKUP_ENDPOINT/,
    );
    assert.throws(
      () => loadBackupConfig({ DATABASE_URL: URL_OK, NODE_ENV: 'production' }),
      /BACKUP_BUCKET/,
    );
    assert.ok(loadBackupConfig({ DATABASE_URL: URL_OK, NODE_ENV: 'production', ...BUCKET_ENV }));
  });
});

describe('TASK-157: tên file và xoá bản cũ', () => {
  let dir: string;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sao-luu-'));
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('tên file mang thời điểm UTC, đọc lại được', () => {
    const at = new Date('2026-10-10T19:05:09.123Z');
    const name = backupFileName('real_estate_os', at);
    assert.equal(name, 'real_estate_os-20261010T190509Z.dump');
    assert.equal(backupTime(name)?.toISOString(), '2026-10-10T19:05:09.000Z');
    assert.equal(backupTime('ghi-chu.txt'), null);
    assert.equal(backupTime(`${name}.partial`), null);
  });

  it('xoá bản cũ hơn số ngày giữ, giữ bản mới nhất và không đụng file khác', async () => {
    const now = new Date('2026-10-20T02:00:00Z');
    const days = [1, 6, 8, 30];
    for (const day of days) {
      await writeFile(
        join(dir, backupFileName('db', new Date(now.getTime() - day * 86_400_000))),
        'x',
      );
    }
    await writeFile(join(dir, 'ghi-chu.txt'), 'x');
    await writeFile(
      join(dir, `${backupFileName('db', new Date('2020-01-01T00:00:00Z'))}.partial`),
      'x',
    );

    const removed = await pruneLocalBackups(dir, 7, now);
    assert.deepEqual(removed.sort(), ['db-20260920T020000Z.dump', 'db-20261012T020000Z.dump']);
    assert.deepEqual(
      (await listLocalBackups(dir)).map((item) => item.name),
      ['db-20261019T020000Z.dump', 'db-20261014T020000Z.dump'],
    );
    assert.ok((await readdir(dir)).includes('ghi-chu.txt'));

    // Sao lưu ngừng lâu: bản duy nhất còn lại vẫn được giữ.
    assert.deepEqual(await pruneLocalBackups(dir, 1, new Date('2027-01-01T00:00:00Z')), [
      'db-20261014T020000Z.dump',
    ]);
    assert.deepEqual(
      (await listLocalBackups(dir)).map((item) => item.name),
      ['db-20261019T020000Z.dump'],
    );
  });
});

describe('TASK-157: sao lưu và khôi phục database', () => {
  let config: BackupConfig;
  let dir: string;
  let sourceUrl: string;
  let restored: string;

  before(async () => {
    sourceUrl = await prepareTestDatabase('backend_backup');
    dir = await mkdtemp(join(tmpdir(), 'sao-luu-db-'));
    config = { databaseUrl: sourceUrl, dir, keepDays: 7, storage: null };
    restored = `${databaseName(sourceUrl)}_restored`;
    const db = new DataSource({ type: 'postgres', url: sourceUrl });
    await db.initialize();
    try {
      await db.query(
        `INSERT INTO companies (name, slug) VALUES ('Công ty sao lưu', 'sao-luu'), ('Công ty thứ hai', 'thu-hai')`,
      );
    } finally {
      await db.destroy();
    }
  });

  after(async () => {
    await dropDatabase(sourceUrl, restored);
    await rm(dir, { recursive: true, force: true });
  });

  async function dropDatabase(url: string, name: string): Promise<void> {
    const db = new DataSource({ type: 'postgres', url });
    await db.initialize();
    try {
      await db.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await db.destroy();
    }
  }

  it('sao lưu ra file đọc được, không để lại file tạm; khôi phục vào database mới cho cùng dữ liệu', async () => {
    const file = await createBackup(config, new Date('2026-10-10T02:00:00Z'));
    assert.equal(file.name, `${databaseName(sourceUrl)}-20261010T020000Z.dump`);
    assert.ok(file.sizeBytes > 0);
    assert.match(file.sha256, /^[0-9a-f]{64}$/);
    assert.ok((await verifyArchive(file.path)) > 10);
    assert.deepEqual(await readdir(dir), [file.name]);

    await restoreBackup(config, file.path, restored);
    const restoredUrl = new URL(sourceUrl);
    restoredUrl.pathname = `/${restored}`;
    const [source, copy] = [
      await inspectDatabase(sourceUrl),
      await inspectDatabase(restoredUrl.toString()),
    ];
    assert.deepEqual(copy, source);
    assert.equal(copy.rows['companies'], 2);
    assert.ok(copy.lastMigration);
  });

  it('không bao giờ khôi phục đè lên database đã có, kể cả database đang chạy', async () => {
    const [latest] = await listLocalBackups(dir);
    const path = join(dir, latest?.name ?? '');
    await assert.rejects(restoreBackup(config, path, restored), /đã có/);
    await assert.rejects(restoreBackup(config, path, databaseName(sourceUrl)), /đã có/);
    await assert.rejects(restoreBackup(config, path, 'Ten-Sai'), /không hợp lệ/);
  });

  it('file hỏng thì không tạo database nào', async () => {
    const broken = join(dir, 'hong.dump');
    await writeFile(broken, 'không phải bản sao lưu');
    await assert.rejects(restoreBackup(config, broken, `${restored}_hong`), /pg_restore/);
    const db = new DataSource({ type: 'postgres', url: sourceUrl });
    await db.initialize();
    try {
      const rows: unknown[] = await db.query('SELECT 1 FROM pg_database WHERE datname = $1', [
        `${restored}_hong`,
      ]);
      assert.equal(rows.length, 0);
    } finally {
      await db.destroy();
      await rm(broken);
    }
  });

  it('diễn tập khôi phục đếm đủ bảng, dòng rồi xoá database tạm', async () => {
    const [latest] = await listLocalBackups(dir);
    const result = await checkRestore(config, join(dir, latest?.name ?? ''));
    assert.equal(result.database, `${databaseName(sourceUrl)}_restore_check`);
    assert.equal(result.rows['companies'], 2);
    assert.ok(result.tables > 10);

    const db = new DataSource({ type: 'postgres', url: sourceUrl });
    await db.initialize();
    try {
      const rows: unknown[] = await db.query('SELECT 1 FROM pg_database WHERE datname = $1', [
        result.database,
      ]);
      assert.equal(rows.length, 0);
    } finally {
      await db.destroy();
    }
  });
});

describe('TASK-157: gửi và tải bản sao lưu qua kho S3', () => {
  let server: Server;
  let dir: string;
  const objects = new Map<string, { body: Buffer; sha256: string | undefined }>();
  let storage: NonNullable<BackupConfig['storage']>;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sao-luu-s3-'));
    // S3 giả: PUT lưu object và metadata, GET trả lại (không kiểm chữ ký).
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0] ?? '');
        if (req.method === 'PUT') {
          objects.set(path, {
            body: Buffer.concat(chunks),
            sha256: req.headers['x-amz-meta-sha256'] as string | undefined,
          });
          res.writeHead(200, { etag: '"1"' }).end();
          return;
        }
        const object = objects.get(path);
        if (req.method === 'GET' && object) {
          res
            .writeHead(200, {
              'content-length': object.body.length,
              ...(object.sha256 ? { 'x-amz-meta-sha256': object.sha256 } : {}),
            })
            .end(object.body);
          return;
        }
        res.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    storage = {
      endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      region: 'us-east-1',
      bucket: 'sao-luu',
      prefix: 'database/',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      forcePathStyle: true,
    };
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });

  it('gửi kèm SHA-256, tải về đúng nội dung; nội dung hỏng thì báo lỗi, không để lại file', async () => {
    const name = backupFileName('db', new Date('2026-10-10T02:00:00Z'));
    const path = join(dir, name);
    await writeFile(path, 'noi dung ban sao luu');
    const file = {
      path,
      name,
      sizeBytes: 20,
      sha256: createHash('sha256').update('noi dung ban sao luu').digest('hex'),
      createdAt: new Date(),
    };

    assert.equal(await uploadBackup(storage, file), `database/${name}`);
    const stored = objects.get(`/sao-luu/database/${name}`);
    assert.equal(stored?.body.toString(), 'noi dung ban sao luu');
    assert.equal(stored?.sha256, file.sha256);

    const downloadDir = join(dir, 'tai-ve');
    const downloaded = await downloadBackup(storage, name, downloadDir);
    assert.equal(downloaded, join(downloadDir, name));

    if (stored) {
      stored.body = Buffer.from('noi dung bi hong!!!!');
    }
    await rm(downloaded);
    await assert.rejects(downloadBackup(storage, name, downloadDir), /SHA-256/);
    assert.deepEqual(await readdir(downloadDir), []);
    await assert.rejects(downloadBackup(storage, '../khac.dump', downloadDir), /không hợp lệ/);
  });
});
