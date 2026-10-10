import { DataSource } from 'typeorm';

import { createDataSource } from '../src/data-source.ts';

/**
 * URL database dùng cho test: TEST_DATABASE_URL, hoặc DATABASE_URL đổi tên database thành `<tên>_test`.
 * Test xoá toàn bộ schema, nên chỉ chấp nhận database có tên kết thúc bằng `_test`.
 */
export function testDatabaseUrl(): string {
  const explicit = process.env['TEST_DATABASE_URL'];
  const base = explicit ?? process.env['DATABASE_URL'];
  if (!base) {
    throw new Error('Cần TEST_DATABASE_URL hoặc DATABASE_URL để chạy test database');
  }
  const url = new URL(base);
  if (!explicit) {
    url.pathname = `${url.pathname}_test`;
  }
  if (!url.pathname.endsWith('_test')) {
    throw new Error(`Từ chối chạy test trên database không phải *_test: ${url.pathname}`);
  }
  return url.toString();
}

/** Tạo database test nếu chưa có (kết nối qua database `postgres`). */
async function ensureDatabaseExists(url: string): Promise<void> {
  const target = new URL(url);
  const dbName = decodeURIComponent(target.pathname.slice(1));
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const adminSource = new DataSource({ type: 'postgres', url: admin.toString() });
  await adminSource.initialize();
  try {
    const rows: unknown[] = await adminSource.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName],
    );
    if (rows.length === 0) {
      await adminSource.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    }
  } finally {
    await adminSource.destroy();
  }
}

/** Database test sạch: xoá và tạo lại schema public, chưa chạy migration nào. */
export async function createCleanTestDataSource(): Promise<DataSource> {
  const url = testDatabaseUrl();
  await ensureDatabaseExists(url);
  const dataSource = createDataSource(url);
  await dataSource.initialize();
  await dataSource.query('DROP SCHEMA public CASCADE');
  await dataSource.query('CREATE SCHEMA public');
  return dataSource;
}

/** Hoàn tác toàn bộ migration đã chạy. */
export async function revertAll(dataSource: DataSource): Promise<void> {
  while (true) {
    const rows: unknown[] = await dataSource.query(`SELECT 1 FROM migrations LIMIT 1`);
    if (rows.length === 0) {
      return;
    }
    await dataSource.undoLastMigration();
  }
}

/** Chèn một dòng vào bảng (tên bảng là hằng số trong test) và trả về dòng vừa tạo. */
export async function insertRow(
  dataSource: DataSource,
  table: string,
  values: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const columns = Object.keys(values);
  const params = columns.map((_, index) => `$${index + 1}`).join(', ');
  const rows: Record<string, unknown>[] = await dataSource.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${params}) RETURNING *`,
    Object.values(values),
  );
  const row = rows[0];
  if (!row) {
    throw new Error(`Không chèn được vào ${table}`);
  }
  return row;
}

export interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
}

/** Danh sách [tên cột, kiểu, có NULL] theo thứ tự cột. */
export async function describeTable(
  dataSource: DataSource,
  table: string,
): Promise<[string, string, string][]> {
  const columns: ColumnInfo[] = await dataSource.query(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  return columns.map((c) => [c.column_name, c.data_type, c.is_nullable]);
}
