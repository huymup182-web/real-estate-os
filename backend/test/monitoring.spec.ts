import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';

import { createApp } from '../src/app.factory.js';
import { MetricsService } from '../src/monitoring/metrics.service.js';
import { PropertyVerificationJob } from '../src/properties/property-verification.job.js';
import { useTestDatabase } from './support/test-database.js';

const TOKEN = 'token-metrics-test-du-dai-32-ky-tu-abcdef';

describe('TASK-158: MetricsService', () => {
  it('histogram cộng dồn theo mốc, có _sum và _count; nhãn được escape', () => {
    const metrics = new MetricsService();
    try {
      metrics.requestStarted();
      metrics.requestFinished('GET', '/api/v1/x', 200, 0.07);
      metrics.requestStarted();
      metrics.requestFinished('GET', '/api/v1/x', 200, 3);
      metrics.requestStarted();
      metrics.requestFinished('GET', '/a"b\\c', 500, 0.01);
      const text = metrics.render({ up: true, pool: { total: 3, idle: 2, waiting: 0 } });

      assert.match(
        text,
        /^http_requests_total\{method="GET",route="\/api\/v1\/x",status="200"\} 2$/m,
      );
      assert.match(
        text,
        /^http_requests_total\{method="GET",route="\/a\\"b\\\\c",status="500"\} 1$/m,
      );
      assert.match(
        text,
        /^http_request_duration_seconds_bucket\{method="GET",route="\/api\/v1\/x",le="0.05"\} 0$/m,
      );
      assert.match(
        text,
        /^http_request_duration_seconds_bucket\{method="GET",route="\/api\/v1\/x",le="0.1"\} 1$/m,
      );
      assert.match(
        text,
        /^http_request_duration_seconds_bucket\{method="GET",route="\/api\/v1\/x",le="2.5"\} 1$/m,
      );
      assert.match(
        text,
        /^http_request_duration_seconds_bucket\{method="GET",route="\/api\/v1\/x",le="5"\} 2$/m,
      );
      assert.match(
        text,
        /^http_request_duration_seconds_bucket\{method="GET",route="\/api\/v1\/x",le="\+Inf"\} 2$/m,
      );
      assert.match(
        text,
        /^http_request_duration_seconds_sum\{method="GET",route="\/api\/v1\/x"\} 3.07$/m,
      );
      assert.match(
        text,
        /^http_request_duration_seconds_count\{method="GET",route="\/api\/v1\/x"\} 2$/m,
      );
      assert.match(text, /^http_requests_in_flight 0$/m);
      assert.match(text, /^db_up 1$/m);
      assert.match(text, /^db_pool_connections\{state="idle"\} 2$/m);
      assert.match(text, /^db_pool_waiting_requests 0$/m);
      assert.match(text, /^process_resident_memory_bytes \d+$/m);
      assert.match(text, /^nodejs_eventloop_lag_p99_seconds [\d.e-]+$/m);
      assert.ok(text.endsWith('\n'));
    } finally {
      metrics.onModuleDestroy();
    }
  });

  it('job: đếm thành công, thất bại và thời điểm thành công gần nhất', () => {
    const metrics = new MetricsService();
    try {
      metrics.jobFinished('nhac-lich', false, 1_000_000);
      assert.doesNotMatch(
        metrics.render({ up: false, pool: null }),
        /job_last_success_timestamp_seconds\{/,
      );
      metrics.jobFinished('nhac-lich', true, 1_791_000_000_500);
      const text = metrics.render({ up: false, pool: null });
      assert.match(text, /^job_runs_total\{job="nhac-lich",result="success"\} 1$/m);
      assert.match(text, /^job_runs_total\{job="nhac-lich",result="failure"\} 1$/m);
      assert.match(text, /^job_last_success_timestamp_seconds\{job="nhac-lich"\} 1791000000$/m);
      assert.match(text, /^db_up 0$/m);
      assert.doesNotMatch(text, /db_pool_connections/);
    } finally {
      metrics.onModuleDestroy();
    }
  });
});

describe('TASK-158: GET /metrics', () => {
  let app: INestApplication;
  let baseUrl: string;
  const previous = process.env['METRICS_TOKEN'];

  before(async () => {
    await useTestDatabase();
    process.env['METRICS_TOKEN'] = TOKEN;
    app = await createApp();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  });

  after(async () => {
    await app.close();
    restoreToken(previous);
  });

  function scrape(token?: string): Promise<Response> {
    return fetch(`${baseUrl}/metrics`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });
  }

  it('cần đúng token; trả text Prometheus, nhãn là mẫu route chứ không phải URL thật', async () => {
    const propertyId = '0b9c3c7e-8f6e-4a43-9a51-0a2b7c3d4e5f';
    assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/properties/${propertyId}`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/khong-co/${propertyId}`)).status, 404);

    assert.equal((await scrape()).status, 401);
    assert.equal((await scrape('sai')).status, 401);
    assert.equal((await scrape(`${TOKEN}x`)).status, 401);

    const response = await scrape(TOKEN);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/plain; version=0.0.4/);
    const text = await response.text();
    assert.match(
      text,
      /^http_requests_total\{method="GET",route="\/api\/v1\/health",status="200"\} 1$/m,
    );
    assert.match(
      text,
      /^http_requests_total\{method="GET",route="\/api\/v1\/properties\/:id",status="401"\} 1$/m,
    );
    assert.match(text, /^http_requests_total\{method="GET",route="unmatched",status="404"\} 1$/m);
    assert.ok(!text.includes(propertyId));
    assert.match(text, /^db_up 1$/m);
    assert.match(text, /^db_pool_connections\{state="total"\} \d+$/m);
  });

  it('job định kỳ ghi số lần chạy và lần thành công gần nhất', async () => {
    await app.get(PropertyVerificationJob).run();
    const text = await (await scrape(TOKEN)).text();
    assert.match(text, /^job_runs_total\{job="property-verification",result="success"\} 1$/m);
    assert.match(text, /^job_last_success_timestamp_seconds\{job="property-verification"\} \d+$/m);
  });
});

describe('TASK-158: chưa đặt METRICS_TOKEN', () => {
  let app: INestApplication;
  const previous = process.env['METRICS_TOKEN'];

  before(async () => {
    await useTestDatabase();
    delete process.env['METRICS_TOKEN'];
    app = await createApp();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
  });

  after(async () => {
    await app.close();
    restoreToken(previous);
  });

  it('endpoint tắt: 404 kể cả khi gửi token', async () => {
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/metrics`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(response.status, 404);
  });
});

function restoreToken(value: string | undefined): void {
  if (value === undefined) {
    delete process.env['METRICS_TOKEN'];
  } else {
    process.env['METRICS_TOKEN'] = value;
  }
}
