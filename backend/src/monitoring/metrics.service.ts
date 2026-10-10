import { monitorEventLoopDelay } from 'node:perf_hooks';

import { Injectable, type OnModuleDestroy } from '@nestjs/common';

/** Mốc (giây) của histogram thời gian xử lý request; ngưỡng 1 giây là mục tiêu p95 (docs/performance.md). */
export const HTTP_DURATION_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;

/** Nhãn route của request không khớp route nào (404), để không sinh một chuỗi nhãn cho mỗi URL lạ. */
export const UNMATCHED_ROUTE = 'unmatched';

interface HttpSeries {
  method: string;
  route: string;
  status: string;
  count: number;
}

interface DurationSeries {
  method: string;
  route: string;
  buckets: number[];
  sum: number;
  count: number;
}

interface JobSeries {
  success: number;
  failure: number;
  lastSuccessSeconds: number | null;
}

/** Số liệu kết nối database, đọc lúc xuất metrics. */
export interface DatabaseStats {
  up: boolean;
  /** null khi driver không cho biết. */
  pool: { total: number; idle: number; waiting: number } | null;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function labels(values: Record<string, string>): string {
  const parts = Object.entries(values).map(([key, value]) => `${key}="${escapeLabel(value)}"`);
  return parts.length > 0 ? `{${parts.join(',')}}` : '';
}

/**
 * Số liệu giám sát của một instance backend (TASK-158), xuất dạng text Prometheus ở `GET /api/v1/metrics`.
 * Giữ trong bộ nhớ, không thêm thư viện: HTTP (số request, thời gian), job định kỳ, tiến trình Node, database.
 * Mỗi instance có số liệu riêng; hệ thống giám sát cộng lại theo nhãn `instance` (docs/monitoring.md).
 */
@Injectable()
export class MetricsService implements OnModuleDestroy {
  private readonly requests = new Map<string, HttpSeries>();
  private readonly durations = new Map<string, DurationSeries>();
  private readonly jobs = new Map<string, JobSeries>();
  private readonly crashes = new Map<string, number>();
  private inFlight = 0;
  private readonly eventLoop = monitorEventLoopDelay({ resolution: 20 });

  constructor() {
    this.eventLoop.enable();
  }

  onModuleDestroy(): void {
    this.eventLoop.disable();
  }

  requestStarted(): void {
    this.inFlight += 1;
  }

  /** Ghi một request đã xong; `route` là mẫu route (vd `/api/v1/properties/:id`), không phải URL thật. */
  requestFinished(method: string, route: string, status: number, seconds: number): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const requestKey = `${method} ${route} ${status}`;
    const request = this.requests.get(requestKey) ?? {
      method,
      route,
      status: String(status),
      count: 0,
    };
    request.count += 1;
    this.requests.set(requestKey, request);

    const durationKey = `${method} ${route}`;
    const duration = this.durations.get(durationKey) ?? {
      method,
      route,
      buckets: HTTP_DURATION_BUCKETS.map(() => 0),
      sum: 0,
      count: 0,
    };
    HTTP_DURATION_BUCKETS.forEach((bound, index) => {
      if (seconds <= bound) {
        duration.buckets[index] = (duration.buckets[index] ?? 0) + 1;
      }
    });
    duration.sum += seconds;
    duration.count += 1;
    this.durations.set(durationKey, duration);
  }

  /** Ghi một lần chạy job định kỳ. */
  jobFinished(job: string, ok: boolean, now = Date.now()): void {
    const series = this.jobs.get(job) ?? { success: 0, failure: 0, lastSuccessSeconds: null };
    if (ok) {
      series.success += 1;
      series.lastSuccessSeconds = Math.floor(now / 1000);
    } else {
      series.failure += 1;
    }
    this.jobs.set(job, series);
  }

  /** Ghi một báo cáo lỗi từ client (TASK-159). */
  crashReported(platform: string): void {
    this.crashes.set(platform, (this.crashes.get(platform) ?? 0) + 1);
  }

  /** Text Prometheus (exposition format 0.0.4). */
  render(database: DatabaseStats): string {
    const lines: string[] = [];
    const metric = (name: string, type: string, help: string): void => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    };

    metric(
      'http_requests_total',
      'counter',
      'Số request HTTP đã xử lý, theo method, route, status.',
    );
    for (const series of this.requests.values()) {
      const { method, route, status } = series;
      lines.push(`http_requests_total${labels({ method, route, status })} ${series.count}`);
    }

    metric('http_request_duration_seconds', 'histogram', 'Thời gian xử lý request HTTP (giây).');
    for (const series of this.durations.values()) {
      const base = { method: series.method, route: series.route };
      HTTP_DURATION_BUCKETS.forEach((bound, index) => {
        lines.push(
          `http_request_duration_seconds_bucket${labels({ ...base, le: String(bound) })} ${series.buckets[index] ?? 0}`,
        );
      });
      lines.push(
        `http_request_duration_seconds_bucket${labels({ ...base, le: '+Inf' })} ${series.count}`,
        `http_request_duration_seconds_sum${labels(base)} ${series.sum}`,
        `http_request_duration_seconds_count${labels(base)} ${series.count}`,
      );
    }

    metric('http_requests_in_flight', 'gauge', 'Số request HTTP đang xử lý.');
    lines.push(`http_requests_in_flight ${this.inFlight}`);

    metric('job_runs_total', 'counter', 'Số lần chạy job định kỳ, theo kết quả.');
    for (const [job, series] of this.jobs) {
      lines.push(`job_runs_total${labels({ job, result: 'success' })} ${series.success}`);
      lines.push(`job_runs_total${labels({ job, result: 'failure' })} ${series.failure}`);
    }
    metric(
      'job_last_success_timestamp_seconds',
      'gauge',
      'Thời điểm (Unix, giây) job chạy thành công gần nhất.',
    );
    for (const [job, series] of this.jobs) {
      if (series.lastSuccessSeconds !== null) {
        lines.push(
          `job_last_success_timestamp_seconds${labels({ job })} ${series.lastSuccessSeconds}`,
        );
      }
    }

    metric(
      'crash_reports_total',
      'counter',
      'Số báo cáo lỗi từ web quản trị và app, theo nền tảng.',
    );
    for (const [platform, count] of this.crashes) {
      lines.push(`crash_reports_total${labels({ platform })} ${count}`);
    }

    metric('db_up', 'gauge', '1 nếu database trả lời SELECT 1, 0 nếu không.');
    lines.push(`db_up ${database.up ? 1 : 0}`);
    if (database.pool) {
      metric('db_pool_connections', 'gauge', 'Kết nối trong pool database, theo trạng thái.');
      lines.push(`db_pool_connections${labels({ state: 'total' })} ${database.pool.total}`);
      lines.push(`db_pool_connections${labels({ state: 'idle' })} ${database.pool.idle}`);
      metric('db_pool_waiting_requests', 'gauge', 'Số truy vấn đang chờ kết nối rảnh.');
      lines.push(`db_pool_waiting_requests ${database.pool.waiting}`);
    }

    const memory = process.memoryUsage();
    metric('process_resident_memory_bytes', 'gauge', 'Bộ nhớ RSS của tiến trình (byte).');
    lines.push(`process_resident_memory_bytes ${memory.rss}`);
    metric('nodejs_heap_used_bytes', 'gauge', 'Heap V8 đang dùng (byte).');
    lines.push(`nodejs_heap_used_bytes ${memory.heapUsed}`);
    metric('process_uptime_seconds', 'gauge', 'Thời gian tiến trình đã chạy (giây).');
    lines.push(`process_uptime_seconds ${Math.floor(process.uptime())}`);
    metric(
      'nodejs_eventloop_lag_p99_seconds',
      'gauge',
      'Độ trễ event loop p99 (giây) từ lần đọc metrics trước.',
    );
    lines.push(`nodejs_eventloop_lag_p99_seconds ${this.eventLoop.percentile(99) / 1e9}`);
    this.eventLoop.reset();

    return `${lines.join('\n')}\n`;
  }
}
