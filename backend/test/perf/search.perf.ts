import 'reflect-metadata';

import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../../src/app.factory.js';
import { hashPassword } from '../../src/auth/password.js';
import { prepareTestDatabase } from '../support/test-database.js';

/**
 * Đo hiệu năng tìm kiếm BĐS (TASK-076). Mục tiêu PRD (phase0/01-PRD.md, phi chức năng): search < 1s với
 * ~100k BĐS/công ty. Chạy: `npm run perf:search` (database riêng `<db>_backend_perf`, xoá và tạo lại).
 *
 * - Công ty A có PERF_ROWS BĐS (mặc định 100.000), công ty B có 20% số đó để kiểm tách công ty không làm chậm.
 * - Gọi qua HTTP như client thật (gồm xác thực, kiểm quyền, đếm tổng, phân trang), mỗi truy vấn chạy
 *   PERF_RUNS lần (mặc định 20) sau 2 lần khởi động; báo p50/p95/max và số kết quả.
 * - Truy vấn nào p95 ≥ PERF_P95_MS (mặc định 1000) thì exit code 1.
 */
const ROWS = Number(process.env['PERF_ROWS'] ?? 100_000);
const RUNS = Number(process.env['PERF_RUNS'] ?? 20);
const P95_LIMIT_MS = Number(process.env['PERF_P95_MS'] ?? 1000);
const PASSWORD = 'mat-khau-dung-8';

/** Kết quả đo in ra stdout (script dòng lệnh, không qua logger của app). */
function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

interface Case {
  name: string;
  user: 'admin' | 'agent';
  path: string;
}

interface Result {
  name: string;
  user: string;
  total: number;
  p50: number;
  p95: number;
  max: number;
}

async function main(): Promise<void> {
  process.env['DATABASE_URL'] = await prepareTestDatabase('backend_perf');
  const app: INestApplication = await createApp();
  app.useLogger(false);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const db = app.get(DataSource);

  try {
    const seeded = await seed(baseUrl, db);
    const tokens = {
      admin: await login(baseUrl, 'admin@perf-a.vn'),
      agent: await login(baseUrl, 'agent1@perf-a.vn'),
    };
    const saved = (await post(
      baseUrl,
      '/saved-searches',
      {
        name: 'Nhà phố 3-6 tỷ',
        filters: {
          q: 'nha pho',
          propertyType: 'HOUSE,SHOPHOUSE',
          priceMin: 3_000_000_000,
          priceMax: 6_000_000_000,
        },
      },
      tokens.agent,
    )) as { id: string };

    const cases: Case[] = [
      { name: 'Danh sách mặc định (mới nhất)', user: 'agent', path: '/properties' },
      { name: 'Trang sâu (page=2000)', user: 'agent', path: '/properties?page=2000' },
      { name: 'Từ khoá phổ biến "nha pho"', user: 'agent', path: '/properties?q=nha%20pho' },
      { name: 'Từ khoá phổ biến (admin)', user: 'admin', path: '/properties?q=nha%20pho' },
      {
        name: 'Từ khoá nhiều từ "biet thu ho boi"',
        user: 'agent',
        path: '/properties?q=biet%20thu%20ho%20boi',
      },
      { name: 'Từ khoá gõ dở "hem xe h"', user: 'agent', path: '/properties?q=hem%20xe%20h' },
      { name: 'Đúng mã BĐS', user: 'agent', path: `/properties?q=${seeded.sampleCode}` },
      {
        name: 'Giá + loại + phòng ngủ, xếp giá tăng',
        user: 'agent',
        path: '/properties?priceMin=2000000000&priceMax=5000000000&propertyType=HOUSE,APARTMENT&bedroomsMin=3&sort=price_asc',
      },
      {
        name: 'Tỉnh + phường, xếp giá giảm',
        user: 'agent',
        path: `/properties?provinceId=${seeded.provinceId}&wardId=${seeded.wardId}&sort=price_desc`,
      },
      {
        name: 'Diện tích, xếp diện tích tăng',
        user: 'agent',
        path: '/properties?areaMin=80&areaMax=120&sort=area_asc',
      },
      {
        name: 'Pháp lý + hướng + đường ≥ 6m',
        user: 'agent',
        path: '/properties?legalStatus=PRIVATE_BOOK&direction=E,SE,S&roadWidthMin=6',
      },
      {
        name: 'Từ khoá + mọi bộ lọc, theo độ khớp',
        user: 'agent',
        path: `/properties?q=nha%20pho&provinceId=${seeded.provinceId}&priceMax=8000000000&areaMin=50&bedroomsMin=2&legalStatus=PRIVATE_BOOK,SHARED_BOOK&sort=relevance`,
      },
      {
        name: 'Chạy lại tìm kiếm đã lưu',
        user: 'agent',
        path: `/saved-searches/${saved.id}/properties`,
      },
    ];

    const results: Result[] = [];
    for (const item of cases) {
      results.push(await measure(baseUrl, item, tokens[item.user]));
    }
    printReport(results, seeded);
    const failed = results.filter((result) => result.p95 >= P95_LIMIT_MS);
    if (failed.length > 0) {
      console.error(`\nKHÔNG ĐẠT: ${failed.length} truy vấn có p95 ≥ ${P95_LIMIT_MS} ms`);
      process.exitCode = 1;
    } else {
      print(`\nĐẠT: mọi truy vấn p95 < ${P95_LIMIT_MS} ms`);
    }
  } finally {
    await app.close();
  }
}

async function measure(baseUrl: string, item: Case, token: string): Promise<Result> {
  const timings: number[] = [];
  let total = 0;
  for (let run = 0; run < RUNS + 2; run += 1) {
    const started = performance.now();
    const response = await fetch(`${baseUrl}${item.path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = (await response.json()) as { meta?: { total: number } };
    const elapsed = performance.now() - started;
    if (response.status !== 200) {
      throw new Error(`${item.name}: HTTP ${response.status} ${JSON.stringify(body)}`);
    }
    total = body.meta?.total ?? 0;
    if (run >= 2) {
      timings.push(elapsed);
    }
  }
  timings.sort((a, b) => a - b);
  const at = (ratio: number): number =>
    timings[Math.min(timings.length - 1, Math.ceil(ratio * timings.length) - 1)] ?? 0;
  return { name: item.name, user: item.user, total, p50: at(0.5), p95: at(0.95), max: at(1) };
}

function printReport(
  results: Result[],
  seeded: { rowsA: number; rowsB: number; seconds: number },
): void {
  print(
    `\nDữ liệu: công ty A ${seeded.rowsA} BĐS, công ty B ${seeded.rowsB} BĐS (seed ${seeded.seconds.toFixed(1)}s); ` +
      `${RUNS} lần đo mỗi truy vấn.\n`,
  );
  print('| Truy vấn | Người gọi | Kết quả | p50 (ms) | p95 (ms) | max (ms) |');
  print('| --- | --- | ---: | ---: | ---: | ---: |');
  for (const result of results) {
    print(
      `| ${result.name} | ${result.user} | ${result.total} | ${result.p50.toFixed(0)} | ${result.p95.toFixed(0)} | ${result.max.toFixed(0)} |`,
    );
  }
}

/**
 * Tạo 2 công ty qua API đăng ký, 20 môi giới cho công ty A, 5 tỉnh × 20 phường, rồi sinh BĐS bằng
 * generate_series (nhanh hơn gọi API hàng trăm nghìn lần). Tiêu đề, mô tả, địa chỉ ghép từ từ vựng BĐS
 * thường gặp để từ khoá có độ phổ biến khác nhau.
 */
async function seed(
  baseUrl: string,
  db: DataSource,
): Promise<{
  rowsA: number;
  rowsB: number;
  seconds: number;
  provinceId: string;
  wardId: string;
  sampleCode: string;
}> {
  const started = performance.now();
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
  for (const [tenantId, rows] of [
    [tenantA, ROWS],
    [tenantB, Math.round(ROWS / 5)],
  ] as const) {
    await seedProperties(db, tenantId, rows);
  }
  await db.query('ANALYZE');
  const [sample] = (await db.query(
    `SELECT p.code, p.province_id, p.ward_id FROM properties p WHERE p.tenant_id = $1 ORDER BY p.code LIMIT 1 OFFSET 777`,
    [tenantA],
  )) as { code: string; province_id: string; ward_id: string }[];
  if (!sample) {
    throw new Error('Seed không tạo được BĐS');
  }
  return {
    rowsA: ROWS,
    rowsB: Math.round(ROWS / 5),
    seconds: (performance.now() - started) / 1000,
    provinceId: sample.province_id,
    wardId: sample.ward_id,
    sampleCode: sample.code,
  };
}

async function seedProperties(db: DataSource, tenantId: string, rows: number): Promise<void> {
  await db.transaction(async (manager) => {
    // Hàm băm tạm (theo phiên) để rải giá trị đều mà vẫn lặp lại được giữa các lần chạy.
    await manager.query(
      `CREATE OR REPLACE FUNCTION pg_temp.h(i int) RETURNS int LANGUAGE sql IMMUTABLE
         AS $$ SELECT ((hashint4(i)::bigint + 2147483648) % 2147483647)::int $$`,
    );
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

async function register(baseUrl: string, email: string): Promise<string> {
  const data = (await post(baseUrl, '/auth/register', {
    companyName: `Công ty ${email}`,
    fullName: 'Quản trị',
    email,
    password: PASSWORD,
  })) as { company: { id: string } };
  return data.company.id;
}

async function login(baseUrl: string, email: string): Promise<string> {
  const data = (await post(baseUrl, '/auth/login', { identifier: email, password: PASSWORD })) as {
    accessToken: string;
  };
  return data.accessToken;
}

async function post(
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

await main();
