import { performance } from 'node:perf_hooks';

import type { DataSource } from 'typeorm';

import { hashPassword } from '../../src/auth/password.js';

/** Phần dùng chung của các script đo hiệu năng (TASK-076, TASK-154): seed, đăng nhập, đo, in bảng. */

export const RUNS = Number(process.env['PERF_RUNS'] ?? 20);
export const P95_LIMIT_MS = Number(process.env['PERF_P95_MS'] ?? 1000);
export const PASSWORD = 'mat-khau-dung-8';

/** Kết quả đo in ra stdout (script dòng lệnh, không qua logger của app). */
export function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

export interface Case<User extends string = string> {
  name: string;
  user: User;
  path: string;
}

export interface Result {
  name: string;
  user: string;
  total: number;
  p50: number;
  p95: number;
  max: number;
}

/**
 * Gọi [item] RUNS lần sau 2 lần khởi động. `total` là `meta.total` (danh sách phân trang), số phần tử của
 * `data` (mảng) hoặc 1 (đối tượng).
 */
export async function measure(baseUrl: string, item: Case, token: string): Promise<Result> {
  const timings: number[] = [];
  let total = 0;
  for (let run = 0; run < RUNS + 2; run += 1) {
    const started = performance.now();
    const response = await fetch(`${baseUrl}${item.path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = (await response.json()) as { data?: unknown; meta?: { total: number } };
    const elapsed = performance.now() - started;
    if (response.status !== 200) {
      throw new Error(`${item.name}: HTTP ${response.status} ${JSON.stringify(body)}`);
    }
    total = body.meta?.total ?? (Array.isArray(body.data) ? body.data.length : 1);
    if (run >= 2) {
      timings.push(elapsed);
    }
  }
  timings.sort((a, b) => a - b);
  const at = (ratio: number): number =>
    timings[Math.min(timings.length - 1, Math.ceil(ratio * timings.length) - 1)] ?? 0;
  return { name: item.name, user: item.user, total, p50: at(0.5), p95: at(0.95), max: at(1) };
}

/** In bảng kết quả (markdown); có truy vấn p95 ≥ P95_LIMIT_MS thì đặt exit code 1. */
export function report(results: Result[]): void {
  print('| Truy vấn | Người gọi | Kết quả | p50 (ms) | p95 (ms) | max (ms) |');
  print('| --- | --- | ---: | ---: | ---: | ---: |');
  for (const result of results) {
    print(
      `| ${result.name} | ${result.user} | ${result.total} | ${result.p50.toFixed(0)} | ${result.p95.toFixed(0)} | ${result.max.toFixed(0)} |`,
    );
  }
  const failed = results.filter((result) => result.p95 >= P95_LIMIT_MS);
  if (failed.length > 0) {
    console.error(`\nKHÔNG ĐẠT: ${failed.length} truy vấn có p95 ≥ ${P95_LIMIT_MS} ms`);
    process.exitCode = 1;
  } else {
    print(`\nĐẠT: mọi truy vấn p95 < ${P95_LIMIT_MS} ms`);
  }
}

/**
 * Tạo 2 công ty qua API đăng ký (admin@perf-a.vn, admin@perf-b.vn), 20 môi giới agent1..20@perf-a.vn cho
 * công ty A, 5 tỉnh × 20 phường. Trả về mã công ty A, B.
 */
export async function seedCompanies(
  baseUrl: string,
  db: DataSource,
): Promise<{ tenantA: string; tenantB: string }> {
  const tenantA = await register(baseUrl, 'admin@perf-a.vn');
  const tenantB = await register(baseUrl, 'admin@perf-b.vn');
  const hash = await hashPassword(PASSWORD);
  await db.query(
    `INSERT INTO users (tenant_id, email, password_hash, full_name)
     SELECT $1, 'agent' || i || '@perf-a.vn', $2, 'Môi giới ' || i FROM generate_series(1, 20) i`,
    [tenantA, hash],
  );
  await db.query(
    `INSERT INTO user_roles (user_id, role_id, tenant_id)
     SELECT u.id, r.id, u.tenant_id FROM users u JOIN roles r ON r.tenant_id = u.tenant_id AND r.code = 'AGENT'
      WHERE u.tenant_id = $1 AND u.email LIKE 'agent%'`,
    [tenantA],
  );
  await db.query(
    `INSERT INTO provinces (code, name) SELECT 'P' || i, 'Tỉnh ' || i FROM generate_series(1, 5) i`,
  );
  await db.query(
    `INSERT INTO wards (province_id, code, name)
     SELECT p.id, p.code || '-' || i, 'Phường ' || i FROM provinces p, generate_series(1, 20) i`,
  );
  return { tenantA, tenantB };
}

/** Hàm băm tạm (theo phiên) để rải giá trị đều mà vẫn lặp lại được giữa các lần chạy. */
export const HASH_FUNCTION = `CREATE OR REPLACE FUNCTION pg_temp.h(i int) RETURNS int LANGUAGE sql IMMUTABLE
  AS $$ SELECT ((hashint4(i)::bigint + 2147483648) % 2147483647)::int $$`;

/**
 * Sinh [rows] BĐS cho công ty bằng generate_series (nhanh hơn gọi API hàng trăm nghìn lần). Tiêu đề, mô tả,
 * địa chỉ ghép từ từ vựng BĐS thường gặp để từ khoá có độ phổ biến khác nhau. BĐS thứ i tạo cách đây i phút.
 */
export async function seedProperties(
  db: DataSource,
  tenantId: string,
  rows: number,
): Promise<void> {
  await db.transaction(async (manager) => {
    await manager.query(HASH_FUNCTION);
    await manager.query(
      `WITH agents AS (
       SELECT array_agg(u.id ORDER BY u.email) AS ids FROM users u WHERE u.tenant_id = $1
     ), wards_all AS (
       SELECT array_agg(w.id ORDER BY w.code) AS ids, array_agg(w.province_id ORDER BY w.code) AS provinces FROM wards w
     ), words AS (
       SELECT ARRAY['Bán nhà phố', 'Nhà phố', 'Căn hộ', 'Biệt thự', 'Đất nền', 'Shophouse', 'Nhà hẻm',
                    'Kho xưởng', 'Đất vườn', 'Nhà mặt tiền'] AS kinds,
              ARRAY['gần biển', 'hẻm xe hơi', 'trung tâm', 'view sông', 'gần chợ', 'khu dân cư',
                    'mặt tiền kinh doanh', 'yên tĩnh', 'sổ hồng riêng', 'có hồ bơi'] AS traits,
              ARRAY['HOUSE','APARTMENT','VILLA','LAND','SHOPHOUSE','HOUSE','WAREHOUSE','AGRICULTURAL_LAND','HOUSE','LAND_PLOT'] AS types,
              ARRAY['PRIVATE_BOOK','SHARED_BOOK','PENDING_BOOK','SALE_CONTRACT','HANDWRITTEN','OTHER'] AS legal,
              ARRAY['N','S','E','W','NE','NW','SE','SW'] AS dirs
     )
     INSERT INTO properties (
       tenant_id, code, title, description, property_type, price, area, bedrooms, bathrooms,
       direction, road_width, legal_status, province_id, ward_id, street_address, status,
       agent_id, created_by, created_at
     )
     SELECT $1,
            'BDS-' || lpad(i::text, 6, '0'),
            words.kinds[1 + i % 10] || ' ' || words.traits[1 + (i / 10) % 10] || ' ' || words.traits[1 + (i * 7) % 10],
            'Bất động sản ' || words.traits[1 + (i * 3) % 10] || ', ' || words.traits[1 + (i * 11) % 10] ||
              CASE WHEN i % 97 = 0 THEN ', biệt thự có hồ bơi riêng' ELSE '' END,
            words.types[1 + i % 10],
            500000000::bigint + (pg_temp.h(i) % 195) * 100000000::bigint,
            30 + (pg_temp.h(i * 13) % 470),
            CASE WHEN i % 7 = 0 THEN NULL ELSE 1 + pg_temp.h(i * 5) % 6 END,
            CASE WHEN i % 7 = 0 THEN NULL ELSE 1 + pg_temp.h(i * 17) % 4 END,
            CASE WHEN i % 5 = 0 THEN NULL ELSE words.dirs[1 + pg_temp.h(i * 19) % 8] END,
            CASE WHEN i % 6 = 0 THEN NULL ELSE (2 + pg_temp.h(i * 23) % 20)::numeric END,
            CASE WHEN i % 9 = 0 THEN NULL ELSE words.legal[1 + pg_temp.h(i * 29) % 6] END,
            wards_all.provinces[1 + pg_temp.h(i * 31) % array_length(wards_all.ids, 1)],
            wards_all.ids[1 + pg_temp.h(i * 31) % array_length(wards_all.ids, 1)],
            (1 + i % 300) || ' Đường số ' || (1 + i % 50),
            CASE WHEN i % 20 = 0 THEN 'SOLD' WHEN i % 33 = 0 THEN 'HIDDEN' ELSE 'AVAILABLE' END,
            agents.ids[1 + i % array_length(agents.ids, 1)],
            agents.ids[1 + i % array_length(agents.ids, 1)],
            now() - make_interval(mins => i)
       FROM generate_series(1, $2::int) i, agents, wards_all, words`,
      [tenantId, rows],
    );
  });
  await db.query(
    `INSERT INTO property_code_counters (tenant_id, last_value) VALUES ($1, $2)
     ON CONFLICT (tenant_id) DO UPDATE SET last_value = EXCLUDED.last_value`,
    [tenantId, rows],
  );
}

export async function register(baseUrl: string, email: string): Promise<string> {
  const data = (await post(baseUrl, '/auth/register', {
    companyName: `Công ty ${email}`,
    fullName: 'Quản trị',
    email,
    password: PASSWORD,
  })) as { company: { id: string } };
  return data.company.id;
}

export async function login(baseUrl: string, email: string): Promise<string> {
  const data = (await post(baseUrl, '/auth/login', { identifier: email, password: PASSWORD })) as {
    accessToken: string;
  };
  return data.accessToken;
}

export async function post(
  baseUrl: string,
  path: string,
  payload: unknown,
  token?: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as { data: Record<string, unknown> };
  if (response.status >= 300) {
    throw new Error(`POST ${path}: HTTP ${response.status} ${JSON.stringify(body)}`);
  }
  return body.data;
}
