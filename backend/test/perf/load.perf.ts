import 'reflect-metadata';

import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../../src/app.factory.js';
import { prepareTestDatabase } from '../support/test-database.js';
import {
  login,
  P95_LIMIT_MS,
  print,
  seedCompanies,
  seedCrm,
  seedProperties,
} from './perf-support.js';

/**
 * Kiểm thử tải (TASK-154 đo từng truy vấn một; TASK-156 đo khi nhiều người dùng cùng lúc). Chạy:
 * `npm run perf:load` (database riêng `<db>_backend_load`, xoá và tạo lại).
 *
 * - Dữ liệu như `perf:crm`: công ty A có LOAD_ROWS BĐS (mặc định 100.000), LOAD_CUSTOMERS khách (50.000).
 * - LOAD_USERS người dùng ảo (mặc định 50: 20 môi giới, mỗi người nhiều phiên, và quản trị) cùng thao tác trong
 *   LOAD_SECONDS giây (mặc định 60). Mỗi lượt chọn ngẫu nhiên một thao tác theo tỷ lệ ở ACTIONS, nghỉ
 *   LOAD_THINK_MS (mặc định 0–2000 ms) rồi làm tiếp. Người thật thao tác chậm hơn nhiều, nên
 *   mỗi người dùng ảo tương đương vài người dùng thật (docs/load-testing.md).
 * - Đạt khi p95 từng thao tác < PERF_P95_MS (mặc định 1000) và tỷ lệ lỗi (HTTP khác 2xx) < 1%.
 */
const ROWS = Number(process.env['LOAD_ROWS'] ?? 100_000);
const CUSTOMERS = Number(process.env['LOAD_CUSTOMERS'] ?? 50_000);
const USERS = Number(process.env['LOAD_USERS'] ?? 50);
const SECONDS = Number(process.env['LOAD_SECONDS'] ?? 60);
const THINK_MS = Number(process.env['LOAD_THINK_MS'] ?? 2000);
const MAX_ERROR_RATE = 0.01;

interface Session {
  role: 'agent' | 'admin';
  token: string;
  customerIds: string[];
}

interface Fixture {
  propertyIds: string[];
  provinceId: string;
}

interface Action {
  name: string;
  weight: number;
  /** Chỉ chạy cho vai trò này; không ghi thì mọi vai trò. */
  role?: Session['role'];
  request: (
    session: Session,
    fixture: Fixture,
  ) => { method: 'GET' | 'POST'; path: string; body?: unknown };
}

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)] as T;
const isoDaysAgo = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString();
const KEYWORDS = ['nha pho', 'can ho', 'biet thu ho boi', 'hem xe h', 'gan bien', 'dat nen'];

/** Tỷ lệ thao tác: phần lớn là xem, tìm BĐS và chăm sóc khách, như ngày làm việc của môi giới. */
const ACTIONS: Action[] = [
  { name: 'Danh sách BĐS', weight: 20, request: () => ({ method: 'GET', path: '/properties' }) },
  {
    name: 'Tìm BĐS theo từ khoá',
    weight: 15,
    request: () => ({ method: 'GET', path: `/properties?q=${encodeURIComponent(pick(KEYWORDS))}` }),
  },
  {
    name: 'Lọc BĐS',
    weight: 10,
    request: (_session, fixture) => ({
      method: 'GET',
      path: `/properties?provinceId=${fixture.provinceId}&priceMax=${(2 + Math.floor(Math.random() * 8)) * 1_000_000_000}&bedroomsMin=2&sort=price_asc`,
    }),
  },
  {
    name: 'Chi tiết BĐS',
    weight: 15,
    request: (_session, fixture) => ({
      method: 'GET',
      path: `/properties/${pick(fixture.propertyIds)}`,
    }),
  },
  { name: 'Danh sách khách', weight: 10, request: () => ({ method: 'GET', path: '/customers' }) },
  {
    name: 'Hoạt động của khách',
    weight: 8,
    role: 'agent',
    request: (session) => ({
      method: 'GET',
      path: `/customers/${pick(session.customerIds)}/activities`,
    }),
  },
  {
    name: 'Ghi chăm sóc khách',
    weight: 5,
    role: 'agent',
    request: (session) => ({
      method: 'POST',
      path: `/customers/${pick(session.customerIds)}/activities`,
      body: { type: 'CALL', content: 'Gọi tư vấn (kiểm thử tải)' },
    }),
  },
  {
    name: 'Lịch hẹn 7 ngày',
    weight: 5,
    request: () => ({
      method: 'GET',
      path: `/appointments?from=${isoDaysAgo(7)}&to=${new Date().toISOString()}`,
    }),
  },
  {
    name: 'Số thông báo chưa đọc',
    weight: 7,
    request: () => ({ method: 'GET', path: '/notifications/unread-count' }),
  },
  {
    name: 'Dashboard 30 ngày',
    weight: 3,
    request: () => ({
      method: 'GET',
      path: `/reports/dashboard?from=${isoDaysAgo(30)}&to=${new Date().toISOString()}`,
    }),
  },
  {
    name: 'Xếp hạng 30 ngày',
    weight: 2,
    request: () => ({
      method: 'GET',
      path: `/reports/leaderboard?from=${isoDaysAgo(30)}&to=${new Date().toISOString()}`,
    }),
  },
];

interface Stats {
  timings: number[];
  errors: number;
  statuses: Map<number, number>;
}

async function main(): Promise<void> {
  process.env['DATABASE_URL'] = await prepareTestDatabase('backend_load');
  const app: INestApplication = await createApp();
  app.useLogger(false);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const db = app.get(DataSource);

  try {
    const started = performance.now();
    const { tenantA, tenantB } = await seedCompanies(baseUrl, db);
    await seedProperties(db, tenantA, ROWS);
    await seedCrm(db, tenantA, CUSTOMERS);
    await seedProperties(db, tenantB, Math.round(ROWS / 5));
    await seedCrm(db, tenantB, Math.round(CUSTOMERS / 5));
    // Như database đang chạy (autovacuum đã chạy): bảng có visibility map để đếm bằng index-only scan.
    await db.query('VACUUM ANALYZE');
    const fixture = await loadFixture(db, tenantA);
    const sessions = await openSessions(baseUrl, db, tenantA);
    print(
      `Seed ${((performance.now() - started) / 1000).toFixed(1)}s; ${USERS} người dùng ảo trong ${SECONDS}s, ` +
        `nghỉ 0–${THINK_MS} ms giữa các thao tác.`,
    );

    const stats = new Map<string, Stats>(
      ACTIONS.map((action) => [action.name, { timings: [], errors: 0, statuses: new Map() }]),
    );
    const deadline = performance.now() + SECONDS * 1000;
    const runStarted = performance.now();
    await Promise.all(
      Array.from({ length: USERS }, (_, index) =>
        virtualUser(
          baseUrl,
          sessions[index % sessions.length] as Session,
          fixture,
          stats,
          deadline,
        ),
      ),
    );
    const elapsed = (performance.now() - runStarted) / 1000;
    report(stats, elapsed);
  } finally {
    await app.close();
  }
}

/** 200 BĐS đang bán và một tỉnh có BĐS để thao tác ngẫu nhiên. */
async function loadFixture(db: DataSource, tenantId: string): Promise<Fixture> {
  const rows = (await db.query(
    `SELECT id, province_id FROM properties WHERE tenant_id = $1 AND status = 'AVAILABLE'
      ORDER BY code LIMIT 200`,
    [tenantId],
  )) as { id: string; province_id: string }[];
  const first = rows[0];
  if (!first) {
    throw new Error('Seed không tạo được BĐS');
  }
  return { propertyIds: rows.map((row) => row.id), provinceId: first.province_id };
}

/**
 * Đăng nhập 20 môi giới (mỗi người có danh sách khách của mình) và quản trị. Người dùng ảo dùng chung phiên
 * theo vòng: nhiều tab của cùng một người.
 */
async function openSessions(baseUrl: string, db: DataSource, tenantId: string): Promise<Session[]> {
  const agents = (await db.query(
    `SELECT u.email, array_agg(c.id ORDER BY c.created_at DESC) FILTER (WHERE c.id IS NOT NULL) AS customer_ids
       FROM users u
       LEFT JOIN LATERAL (SELECT id, created_at FROM customers
                           WHERE tenant_id = u.tenant_id AND agent_id = u.id ORDER BY created_at DESC LIMIT 50) c ON true
      WHERE u.tenant_id = $1 AND u.email LIKE 'agent%'
      GROUP BY u.email ORDER BY u.email`,
    [tenantId],
  )) as { email: string; customer_ids: string[] | null }[];
  const sessions: Session[] = [];
  for (const agent of agents) {
    if (agent.customer_ids?.length) {
      sessions.push({
        role: 'agent',
        token: await login(baseUrl, agent.email),
        customerIds: agent.customer_ids,
      });
    }
  }
  sessions.push({ role: 'admin', token: await login(baseUrl, 'admin@perf-a.vn'), customerIds: [] });
  return sessions;
}

async function virtualUser(
  baseUrl: string,
  session: Session,
  fixture: Fixture,
  stats: Map<string, Stats>,
  deadline: number,
): Promise<void> {
  const actions = ACTIONS.filter((action) => !action.role || action.role === session.role);
  const totalWeight = actions.reduce((sum, action) => sum + action.weight, 0);
  while (performance.now() < deadline) {
    let roll = Math.random() * totalWeight;
    const action = actions.find((item) => (roll -= item.weight) < 0) ?? (actions[0] as Action);
    const { method, path, body } = action.request(session, fixture);
    const entry = stats.get(action.name) as Stats;
    const started = performance.now();
    let status = 0;
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${session.token}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      await response.arrayBuffer();
      status = response.status;
    } catch {
      // Lỗi mạng: giữ status 0, tính là lỗi.
    }
    entry.timings.push(performance.now() - started);
    entry.statuses.set(status, (entry.statuses.get(status) ?? 0) + 1);
    if (status < 200 || status >= 300) {
      entry.errors += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.random() * THINK_MS));
  }
}

function percentile(sorted: number[], ratio: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(ratio * sorted.length) - 1)] ?? 0;
}

function report(stats: Map<string, Stats>, elapsed: number): void {
  const all = [...stats.values()];
  const total = all.reduce((sum, item) => sum + item.timings.length, 0);
  const errors = all.reduce((sum, item) => sum + item.errors, 0);
  print(
    `\n${total} request trong ${elapsed.toFixed(1)}s: ${(total / elapsed).toFixed(1)} request/giây, ` +
      `${errors} lỗi (${((errors / Math.max(total, 1)) * 100).toFixed(2)}%).\n`,
  );
  print('| Thao tác | Số request | Lỗi | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) |');
  print('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  const failed: string[] = [];
  const merged: number[] = [];
  for (const [name, item] of stats) {
    const sorted = [...item.timings].sort((a, b) => a - b);
    merged.push(...sorted);
    const p95 = percentile(sorted, 0.95);
    const badStatuses = [...item.statuses].filter(([status]) => status < 200 || status >= 300);
    print(
      `| ${name} | ${sorted.length} | ${item.errors}${badStatuses.length ? ` (${badStatuses.map(([s, n]) => `${s}×${n}`).join(', ')})` : ''} | ` +
        `${percentile(sorted, 0.5).toFixed(0)} | ${p95.toFixed(0)} | ${percentile(sorted, 0.99).toFixed(0)} | ${(sorted.at(-1) ?? 0).toFixed(0)} |`,
    );
    if (p95 >= P95_LIMIT_MS) {
      failed.push(`${name}: p95 ${p95.toFixed(0)} ms`);
    }
  }
  merged.sort((a, b) => a - b);
  print(
    `| **Tất cả** | ${merged.length} | ${errors} | ${percentile(merged, 0.5).toFixed(0)} | ` +
      `${percentile(merged, 0.95).toFixed(0)} | ${percentile(merged, 0.99).toFixed(0)} | ${(merged.at(-1) ?? 0).toFixed(0)} |`,
  );
  if (errors / Math.max(total, 1) >= MAX_ERROR_RATE) {
    failed.push(`tỷ lệ lỗi ${((errors / total) * 100).toFixed(2)}% ≥ ${MAX_ERROR_RATE * 100}%`);
  }
  if (failed.length > 0) {
    console.error(`\nKHÔNG ĐẠT: ${failed.join('; ')}`);
    process.exitCode = 1;
  } else {
    print(`\nĐẠT: p95 mọi thao tác < ${P95_LIMIT_MS} ms, lỗi < ${MAX_ERROR_RATE * 100}%`);
  }
}

await main();
