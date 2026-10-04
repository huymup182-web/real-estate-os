import { DataSource } from 'typeorm';

const MIGRATIONS_GLOB = new URL('../migrations/*.ts', import.meta.url).pathname;

/**
 * Tạo DataSource chỉ dùng để chạy migration.
 * Không dùng `synchronize`: mọi thay đổi schema phải đi qua migration.
 */
export function createDataSource(databaseUrl: string): DataSource {
  return new DataSource({
    type: 'postgres',
    url: databaseUrl,
    migrations: [MIGRATIONS_GLOB],
    migrationsTableName: 'migrations',
    migrationsTransactionMode: 'each',
    synchronize: false,
    logging: ['error', 'warn'],
  });
}

export function requireDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('Thiếu biến môi trường DATABASE_URL (xem docs/environment.md)');
  }
  return url;
}
