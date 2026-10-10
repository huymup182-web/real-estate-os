import 'reflect-metadata';

import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../../src/app.factory.js';
import { prepareTestDatabase } from '../support/test-database.js';
import {
  type Case,
  HASH_FUNCTION,
  login,
  measure,
  print,
  report,
  type Result,
  RUNS,
  seedCompanies,
  seedProperties,
} from './perf-support.js';

/**
 * Đo hiệu năng CRM, báo cáo, thị trường và matching (TASK-154). Chạy: `npm run perf:crm` (database riêng
 * `<db>_backend_perf_crm`, xoá và tạo lại). Cùng ngưỡng với TASK-076: p95 < 1s.
 *
 * - Công ty A: PERF_ROWS BĐS (mặc định 100.000), PERF_CUSTOMERS khách (mặc định 50.000) tạo rải trong
 *   400 ngày, mỗi khách 0–11 hoạt động, 2/5 khách có lịch hẹn, 1/5 có giao dịch, 1/2 có nhu cầu.
 *   Công ty B: 20% số đó để kiểm tách công ty không làm chậm.
 * - Đo với `admin` (phạm vi công ty) và `agent` (môi giới, phạm vi của mình).
 */
const ROWS = Number(process.env['PERF_ROWS'] ?? 100_000);
const CUSTOMERS = Number(process.env['PERF_CUSTOMERS'] ?? 50_000);

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

async function main(): Promise<void> {
  process.env['DATABASE_URL'] = await prepareTestDatabase('backend_perf_crm');
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
    const now = new Date().toISOString();
    const days = (count: number): string => `from=${isoDaysAgo(count)}&to=${now}`;
    const cases: Case<'admin' | 'agent'>[] = [
      { name: 'Dashboard 30 ngày', user: 'admin', path: `/reports/dashboard?${days(30)}` },
      { name: 'Dashboard 30 ngày', user: 'agent', path: `/reports/dashboard?${days(30)}` },
      { name: 'Dashboard 366 ngày', user: 'admin', path: `/reports/dashboard?${days(366)}` },
      { name: 'Doanh số 12 tháng', user: 'admin', path: `/reports/sales?${days(365)}` },
      { name: 'Doanh số 12 tháng', user: 'agent', path: `/reports/sales?${days(365)}` },
      { name: 'Chuyển đổi 90 ngày', user: 'admin', path: `/reports/conversion?${days(90)}` },
      { name: 'Chuyển đổi 366 ngày', user: 'admin', path: `/reports/conversion?${days(366)}` },
      { name: 'Chuyển đổi 366 ngày', user: 'agent', path: `/reports/conversion?${days(366)}` },
      { name: 'Xếp hạng 30 ngày', user: 'admin', path: `/reports/leaderboard?${days(30)}` },
      { name: 'Xếp hạng 366 ngày', user: 'admin', path: `/reports/leaderboard?${days(366)}` },
      { name: 'Giá thị trường 12 tháng', user: 'admin', path: '/reports/market/prices?months=12' },
      {
        name: 'Giá/m² theo phường 24 tháng',
        user: 'admin',
        path: `/reports/market/price-per-m2?provinceId=${seeded.provinceId}&groupBy=ward&months=24`,
      },
      {
        name: 'Thanh khoản theo loại 12 tháng',
        user: 'admin',
        path: '/reports/market/liquidity?groupBy=propertyType&months=12',
      },
      { name: 'Danh sách khách', user: 'admin', path: '/customers' },
      { name: 'Danh sách khách', user: 'agent', path: '/customers' },
      { name: 'Tìm khách theo tên', user: 'admin', path: '/customers?q=Nguy%E1%BB%85n%20V%C4%83n' },
      { name: 'Tìm khách theo SĐT', user: 'admin', path: '/customers?q=0900%20012' },
      { name: 'Khách theo bước pipeline', user: 'admin', path: '/customers/pipeline' },
      { name: 'Dashboard khách 30 ngày', user: 'admin', path: `/customers/dashboard?${days(30)}` },
      {
        name: 'Hoạt động của một khách',
        user: 'admin',
        path: `/customers/${seeded.customerId}/activities`,
      },
      { name: 'Danh sách giao dịch', user: 'admin', path: '/deals' },
      {
        name: 'Lịch hẹn một tháng',
        user: 'admin',
        path: `/appointments?from=${isoDaysAgo(30)}&to=${now}&pageSize=100`,
      },
      {
        name: 'Lịch hẹn một tháng',
        user: 'agent',
        path: `/appointments?from=${isoDaysAgo(30)}&to=${now}&pageSize=100`,
      },
      {
        name: 'Khách phù hợp với BĐS',
        user: 'admin',
        path: `/properties/${seeded.propertyId}/matching-customers`,
      },
      {
        name: 'BĐS phù hợp với khách',
        user: 'admin',
        path: `/customers/${seeded.customerId}/matching-properties`,
      },
    ];

    const results: Result[] = [];
    for (const item of cases) {
      results.push(await measure(baseUrl, item, tokens[item.user]));
    }
    print(
      `\nDữ liệu công ty A: ${ROWS} BĐS, ${seeded.counts.customers} khách, ${seeded.counts.activities} hoạt động, ` +
        `${seeded.counts.appointments} lịch hẹn, ${seeded.counts.deals} giao dịch, ${seeded.counts.preferences} nhu cầu ` +
        `(seed ${seeded.seconds.toFixed(1)}s); ${RUNS} lần đo mỗi truy vấn.\n`,
    );
    report(results);
  } finally {
    await app.close();
  }
}

interface Seeded {
  seconds: number;
  provinceId: string;
  propertyId: string;
  customerId: string;
  counts: Record<'customers' | 'activities' | 'appointments' | 'deals' | 'preferences', number>;
}

async function seed(baseUrl: string, db: DataSource): Promise<Seeded> {
  const started = performance.now();
  const { tenantA, tenantB } = await seedCompanies(baseUrl, db);
  for (const [tenantId, rows, customers] of [
    [tenantA, ROWS, CUSTOMERS],
    [tenantB, Math.round(ROWS / 5), Math.round(CUSTOMERS / 5)],
  ] as const) {
    await seedProperties(db, tenantId, rows);
    await seedCrm(db, tenantId, customers);
  }
  await db.query('ANALYZE');
  const [sample] = (await db.query(
    `SELECT p.id AS property_id, p.province_id,
            (SELECT cp.customer_id FROM customer_preferences cp WHERE cp.tenant_id = p.tenant_id
              ORDER BY cp.customer_id LIMIT 1) AS customer_id
       FROM properties p WHERE p.tenant_id = $1 AND p.status = 'AVAILABLE' ORDER BY p.code LIMIT 1 OFFSET 777`,
    [tenantA],
  )) as { property_id: string; province_id: string; customer_id: string }[];
  if (!sample) {
    throw new Error('Seed không tạo được dữ liệu');
  }
  const [counts] = (await db.query(
    `SELECT (SELECT count(*) FROM customers WHERE tenant_id = $1)::int AS customers,
            (SELECT count(*) FROM customer_activities WHERE tenant_id = $1)::int AS activities,
            (SELECT count(*) FROM appointments WHERE tenant_id = $1)::int AS appointments,
            (SELECT count(*) FROM deals WHERE tenant_id = $1)::int AS deals,
            (SELECT count(*) FROM customer_preferences WHERE tenant_id = $1)::int AS preferences`,
    [tenantA],
  )) as Seeded['counts'][];
  return {
    seconds: (performance.now() - started) / 1000,
    provinceId: sample.province_id,
    propertyId: sample.property_id,
    customerId: sample.customer_id,
    counts: counts as Seeded['counts'],
  };
}

/**
 * Khách, nhu cầu, hoạt động, lịch hẹn, giao dịch bằng generate_series. Khách thứ n tạo cách đây n × 400/N
 * ngày; 1/25 chưa giao cho ai. Giá trị rải bằng hàm băm để lặp lại được giữa các lần chạy.
 */
async function seedCrm(db: DataSource, tenantId: string, customers: number): Promise<void> {
  await db.transaction(async (manager) => {
    await manager.query(HASH_FUNCTION);
    await manager.query(
      `WITH agents AS (
         SELECT array_agg(u.id ORDER BY u.email) AS ids FROM users u WHERE u.tenant_id = $1
       ), words AS (
         SELECT ARRAY['Nguyễn Văn', 'Trần Thị', 'Lê Văn', 'Phạm Thị', 'Hoàng Văn', 'Võ Thị', 'Đặng Văn', 'Bùi Thị'] AS families,
                ARRAY['An', 'Bình', 'Cường', 'Dung', 'Hải', 'Hoa', 'Khánh', 'Lan', 'Minh', 'Nam'] AS names,
                ARRAY['REFERRAL','WALK_IN','FACEBOOK','ZALO','TIKTOK','WEBSITE','BROKER_PARTNER','OLD_CUSTOMER','OTHER'] AS sources,
                ARRAY['NEW','CONTACTED','QUALIFIED','VIEWING','NEGOTIATING','DEPOSIT','WON','LOST'] AS statuses
       )
       INSERT INTO customers (tenant_id, full_name, phone, source, agent_id, status, created_by, created_at)
       SELECT $1,
              words.families[1 + pg_temp.h(n) % 8] || ' ' || words.names[1 + pg_temp.h(n * 3) % 10],
              '+849' || lpad(n::text, 8, '0'),
              CASE WHEN n % 11 = 0 THEN NULL ELSE words.sources[1 + pg_temp.h(n * 7) % 9] END,
              CASE WHEN n % 25 = 0 THEN NULL ELSE agents.ids[1 + n % array_length(agents.ids, 1)] END,
              words.statuses[1 + pg_temp.h(n * 11) % 8],
              agents.ids[1 + n % array_length(agents.ids, 1)],
              now() - make_interval(secs => n * 400 * 86400.0 / $2)
         FROM generate_series(1, $2::int) n, agents, words`,
      [tenantId, customers],
    );
    // Số thứ tự khách theo lúc tạo (mới nhất là 1) để rải hoạt động, lịch hẹn, giao dịch.
    await manager.query(
      `CREATE TEMP TABLE perf_customers ON COMMIT DROP AS
       SELECT c.id, c.agent_id, c.created_at, c.status,
              row_number() OVER (ORDER BY c.created_at DESC)::int AS n
         FROM customers c WHERE c.tenant_id = $1`,
      [tenantId],
    );
    await manager.query(
      `CREATE TEMP TABLE perf_properties ON COMMIT DROP AS
       SELECT p.id, p.property_type, p.price, p.area, p.province_id,
              row_number() OVER (ORDER BY p.code)::int AS n
         FROM properties p WHERE p.tenant_id = $1`,
      [tenantId],
    );
    const [{ properties }] = (await manager.query(
      'SELECT count(*)::int AS properties FROM perf_properties',
    )) as [{ properties: number }];
    await manager.query(
      `INSERT INTO customer_preferences (tenant_id, customer_id, property_types, budget_min, budget_max,
         area_min, area_max, province_ids)
       SELECT $1, c.id, ARRAY[p.property_type], p.price * 0.7, p.price * 1.3, p.area * 0.7, p.area * 1.3,
              ARRAY[p.province_id]
         FROM perf_customers c
         JOIN perf_properties p ON p.n = 1 + pg_temp.h(c.n * 13) % $2
        WHERE c.n % 2 = 0`,
      [tenantId, properties],
    );
    await manager.query(
      `WITH agents AS (
         SELECT array_agg(u.id ORDER BY u.email) AS ids FROM users u WHERE u.tenant_id = $1
       ), types AS (
         SELECT ARRAY['CALL','MESSAGE','PROPERTY_SENT','VIEWING','NEGOTIATION','DEPOSIT','NOTE','STATUS_CHANGE','ASSIGNMENT'] AS ids
       )
       INSERT INTO customer_activities (tenant_id, customer_id, user_id, type, content, occurred_at, created_at)
       SELECT $1, c.id, coalesce(c.agent_id, agents.ids[1]), types.ids[1 + pg_temp.h(c.n * 17 + k) % 9],
              'Hoạt động ' || k,
              c.created_at + make_interval(hours => k * 20),
              c.created_at + make_interval(hours => k * 20)
         FROM perf_customers c
         CROSS JOIN agents CROSS JOIN types
         CROSS JOIN LATERAL generate_series(1, pg_temp.h(c.n * 19) % 12) k
        WHERE c.created_at + make_interval(hours => k * 20) < now()`,
      [tenantId],
    );
    await manager.query(
      `INSERT INTO appointments (tenant_id, customer_id, property_id, agent_id, scheduled_at, status, created_by, created_at)
       SELECT $1, c.id, p.id, coalesce(c.agent_id, (SELECT u.id FROM users u WHERE u.tenant_id = $1 ORDER BY u.email LIMIT 1)),
              c.created_at + make_interval(days => 1 + pg_temp.h(c.n * 23) % 10),
              CASE WHEN c.created_at + make_interval(days => 1 + pg_temp.h(c.n * 23) % 10) > now() THEN 'SCHEDULED'
                   WHEN c.n % 10 = 3 THEN 'CANCELLED' ELSE 'COMPLETED' END,
              c.agent_id, c.created_at
         FROM perf_customers c
         JOIN perf_properties p ON p.n = 1 + pg_temp.h(c.n * 29) % $2
        WHERE c.n % 5 IN (0, 3)`,
      [tenantId, properties],
    );
    await manager.query(
      `INSERT INTO deals (tenant_id, customer_id, property_id, agent_id, stage, deal_price, closed_at, created_by, created_at)
       SELECT $1, c.id, p.id, coalesce(c.agent_id, (SELECT u.id FROM users u WHERE u.tenant_id = $1 ORDER BY u.email LIMIT 1)),
              s.stage, CASE WHEN s.stage = 'WON' THEN p.price END,
              CASE WHEN s.stage IN ('WON', 'LOST') THEN least(now(), c.created_at + make_interval(days => 5 + pg_temp.h(c.n * 31) % 40)) END,
              c.agent_id, c.created_at + make_interval(days => 3)
         FROM perf_customers c
         JOIN perf_properties p ON p.n = 1 + pg_temp.h(c.n * 37) % $2
         CROSS JOIN LATERAL (SELECT (ARRAY['WON','WON','LOST','NEGOTIATING','DEPOSIT','CONTRACT','WON','LOST','NEGOTIATING','WON'])
                               [1 + pg_temp.h(c.n * 41) % 10] AS stage) s
        WHERE c.n % 5 = 0 AND c.created_at + make_interval(days => 3) < now()`,
      [tenantId, properties],
    );
  });
}

await main();
