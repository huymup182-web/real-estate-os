import { resolve } from 'node:path';

import { DataSource } from 'typeorm';

/**
 * Database riêng cho test backend: `<tên database>_backend_test`, tách khỏi database dev và
 * database test của thư mục database/ (hai bộ test chạy song song không giẫm nhau).
 * Mỗi lần gọi xoá schema rồi chạy toàn bộ migration của database/ (Node ≥ 22.18 chạy trực tiếp file .ts).
 */
export async function prepareTestDatabase(): Promise<string> {
  const base = process.env['DATABASE_URL'];
  if (!base) {
    throw new Error('Cần DATABASE_URL để chạy test backend (xem docs/environment.md)');
  }
  const url = new URL(base);
  const name = `${decodeURIComponent(url.pathname.slice(1))}_backend_test`;
  url.pathname = `/${name}`;

  const admin = new URL(base);
  admin.pathname = '/postgres';
  const adminSource = new DataSource({ type: 'postgres', url: admin.toString() });
  await adminSource.initialize();
  try {
    const rows: unknown[] = await adminSource.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [name],
    );
    if (rows.length === 0) {
      await adminSource.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
    }
  } finally {
    await adminSource.destroy();
  }

  const dataSource = new DataSource({
    type: 'postgres',
    url: url.toString(),
    migrations: [resolve(process.cwd(), '../database/migrations/*.ts')],
    migrationsTransactionMode: 'each',
  });
  await dataSource.initialize();
  try {
    await dataSource.query('DROP SCHEMA public CASCADE');
    await dataSource.query('CREATE SCHEMA public');
    await dataSource.runMigrations();
  } finally {
    await dataSource.destroy();
  }
  return url.toString();
}

/** Trỏ ứng dụng (AppConfigModule) tới database test. */
export async function useTestDatabase(): Promise<void> {
  process.env['DATABASE_URL'] = await prepareTestDatabase();
}
