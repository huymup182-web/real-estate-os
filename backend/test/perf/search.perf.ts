import 'reflect-metadata';

import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../../src/app.factory.js';
import { prepareTestDatabase } from '../support/test-database.js';
import {
  type Case,
  login,
  measure,
  post,
  print,
  report,
  type Result,
  RUNS,
  seedCompanies,
  seedProperties,
} from './perf-support.js';

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

    const cases: Case<'admin' | 'agent'>[] = [
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
    print(
      `\nDữ liệu: công ty A ${seeded.rowsA} BĐS, công ty B ${seeded.rowsB} BĐS (seed ${seeded.seconds.toFixed(1)}s); ` +
        `${RUNS} lần đo mỗi truy vấn.\n`,
    );
    report(results);
  } finally {
    await app.close();
  }
}

/** Hai công ty (perf-support `seedCompanies`), công ty A ROWS BĐS, công ty B 20% số đó. */
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
  const { tenantA, tenantB } = await seedCompanies(baseUrl, db);
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

await main();
