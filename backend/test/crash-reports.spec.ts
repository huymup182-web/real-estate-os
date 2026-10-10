import 'reflect-metadata';

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';

import { createApp } from '../src/app.factory.js';
import { AccessTokenService } from '../src/auth/access-token.service.js';
import { AppLogger } from '../src/common/logging/app-logger.js';
import { RateLimiter } from '../src/common/rate-limit/rate-limiter.js';
import { CRASH_REPORT_RATE_LIMITS, crashFingerprint } from '../src/monitoring/crash-report.js';
import { MetricsService } from '../src/monitoring/metrics.service.js';
import { useTestDatabase } from './support/test-database.js';

type LogLine = Record<string, unknown>;

/** Bắt các dòng log JSON ghi ra stdout/stderr; dòng khác đi tiếp như bình thường. */
function captureLogs(): { lines: LogLine[]; restore: () => void } {
  const lines: LogLine[] = [];
  const originals = { stdout: process.stdout.write, stderr: process.stderr.write };
  for (const stream of ['stdout', 'stderr'] as const) {
    const original = originals[stream];
    process[stream].write = ((chunk: unknown, ...rest: unknown[]): boolean => {
      if (typeof chunk === 'string' && chunk.startsWith('{"level"')) {
        lines.push(JSON.parse(chunk) as LogLine);
        return true;
      }
      return (original as (...args: unknown[]) => boolean).call(process[stream], chunk, ...rest);
    }) as typeof process.stdout.write;
  }
  return {
    lines,
    restore: () => {
      process.stdout.write = originals.stdout;
      process.stderr.write = originals.stderr;
    },
  };
}

const JS_STACK = [
  'TypeError: Cannot read properties of undefined',
  '    at PropertyCard (https://admin.example.vn/_next/static/chunks/app-12ab.js:1:2345)',
  '    at renderWithHooks (https://admin.example.vn/_next/static/chunks/react-9f.js:7:100)',
  '    at beginWork (https://admin.example.vn/_next/static/chunks/react-9f.js:9:200)',
  '    at performUnitOfWork (https://admin.example.vn/_next/static/chunks/react-9f.js:11:300)',
].join('\n');

describe('TASK-159: mã nhóm lỗi', () => {
  const base = { platform: 'admin', name: 'TypeError', message: 'x', stack: JS_STACK };

  it('cùng chỗ trong code thì cùng mã, khác số dòng/cột hay câu lỗi cũng vậy', () => {
    const moved = JS_STACK.replace('1:2345', '3:999').replace('7:100', '8:1');
    assert.equal(crashFingerprint(base), crashFingerprint({ ...base, stack: moved }));
    assert.equal(crashFingerprint(base), crashFingerprint({ ...base, message: 'khác' }));
    assert.match(crashFingerprint(base), /^[0-9a-f]{16}$/);
  });

  it('khác loại lỗi, nền tảng hay frame đầu thì khác mã', () => {
    assert.notEqual(crashFingerprint(base), crashFingerprint({ ...base, name: 'RangeError' }));
    assert.notEqual(crashFingerprint(base), crashFingerprint({ ...base, platform: 'mobile' }));
    assert.notEqual(
      crashFingerprint(base),
      crashFingerprint({ ...base, stack: JS_STACK.replace('PropertyCard', 'CustomerCard') }),
    );
  });

  it('stack Dart; không có stack thì dùng câu lỗi đã bỏ số', () => {
    const dart = '#0      PropertyDetail.build (package:real_estate_os/x.dart:10:5)\n#1      main';
    const mobile = { platform: 'mobile', name: 'StateError', message: 'a' };
    assert.equal(
      crashFingerprint({ ...mobile, stack: dart }),
      crashFingerprint({ ...mobile, stack: dart.replace('10:5', '12:7') }),
    );
    assert.equal(
      crashFingerprint({ ...mobile, message: 'Không tìm thấy BĐS 123' }),
      crashFingerprint({ ...mobile, message: 'Không tìm thấy BĐS 456' }),
    );
  });
});

describe('TASK-159: POST /crash-reports', () => {
  let app: INestApplication;
  let url: string;
  let capture: ReturnType<typeof captureLogs>;

  before(async () => {
    await useTestDatabase();
    capture = captureLogs();
    app = await createApp();
    app.useLogger(new AppLogger('log'));
    await app.listen(0, '127.0.0.1');
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/crash-reports`;
  });

  after(async () => {
    await app.close();
    capture.restore();
  });

  beforeEach(() => {
    capture.lines.length = 0;
    app.get(RateLimiter).clear();
  });

  function send(body: unknown, token?: string): Promise<Response> {
    return fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  function crashLines(): LogLine[] {
    return capture.lines.filter((line) => line['context'] === 'CrashReport');
  }

  const report = {
    platform: 'admin',
    name: 'TypeError',
    message: 'Cannot read properties of undefined',
    stack: JS_STACK,
    route: '/properties/[id]',
    appVersion: '1.4.0+abc123',
    digest: '2846379183',
  };

  it('chưa đăng nhập: 204, ghi một dòng log error kèm mã nhóm, đếm trong metrics', async () => {
    const response = await send(report);
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');

    const [line] = crashLines();
    assert.ok(line);
    assert.equal(line['level'], 'error');
    assert.equal(line['platform'], 'admin');
    assert.equal(line['fingerprint'], crashFingerprint(report));
    assert.equal(line['errorName'], 'TypeError');
    assert.equal(line['errorMessage'], report.message);
    assert.equal(line['errorStack'], JS_STACK);
    assert.equal(line['route'], '/properties/[id]');
    assert.equal(line['appVersion'], '1.4.0+abc123');
    assert.equal(line['digest'], '2846379183');
    assert.equal(line['fatal'], false);
    assert.equal(typeof line['requestId'], 'string');
    assert.equal('userId' in line, false);

    assert.match(
      app.get(MetricsService).render({ up: true, pool: null }),
      /^crash_reports_total\{platform="admin"\} \d+$/m,
    );
  });

  it('có access token: log kèm tenantId, userId; token sai hoặc hết hạn vẫn nhận', async () => {
    const user = {
      userId: '7d1b0c38-7a35-4c39-9a8f-2c1f2f0f6a11',
      tenantId: '0f5d8a1e-3c2b-4e5f-8a9b-1c2d3e4f5a6b',
      sessionId: 'b7e3c1d2-0a4f-4b6e-9c8d-7e6f5a4b3c2d',
    };
    const token = await app.get(AccessTokenService).sign(user);
    assert.equal((await send({ ...report, platform: 'mobile', fatal: true }, token)).status, 204);
    const [line] = crashLines();
    assert.equal(line?.['userId'], user.userId);
    assert.equal(line?.['tenantId'], user.tenantId);
    assert.equal(line?.['fatal'], true);

    capture.lines.length = 0;
    assert.equal((await send(report, 'token-gia')).status, 204);
    assert.equal('userId' in (crashLines()[0] ?? {}), false);
  });

  it('kiểm dữ liệu: nền tảng lạ, route có query, chuỗi quá dài, trường lạ → 400, không ghi log', async () => {
    for (const body of [
      { ...report, platform: 'ios' },
      { ...report, route: '/properties?phone=0909123456' },
      { ...report, route: 'properties' },
      { ...report, message: 'x'.repeat(2001) },
      { ...report, appVersion: '1.0 beta' },
      { ...report, fatal: 'yes' },
      { ...report, email: 'a@b.vn' },
      { platform: 'admin' },
    ]) {
      const response = await send(body);
      assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80));
    }
    assert.equal(crashLines().length, 0);
  });

  it('giới hạn số báo cáo theo IP khi chưa đăng nhập: quá giới hạn thì 429', async () => {
    const { limit } = CRASH_REPORT_RATE_LIMITS.perIp;
    for (let i = 0; i < limit; i++) {
      assert.equal((await send(report)).status, 204);
    }
    const blocked = await send(report);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  });
});

describe('TASK-159: backend dừng vì lỗi không ai bắt', () => {
  const crashLogging = fileURLToPath(
    new URL('../src/monitoring/crash-logging.js', import.meta.url),
  );
  const appLogger = fileURLToPath(new URL('../src/common/logging/app-logger.js', import.meta.url));

  function runCrash(code: string): Promise<{ exitCode: number | null; lines: LogLine[] }> {
    const script = `
      const { logProcessCrashes } = await import(${JSON.stringify(crashLogging)});
      const { AppLogger } = await import(${JSON.stringify(appLogger)});
      logProcessCrashes(new AppLogger('log'));
      ${code}
    `;
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
      child.on('error', reject);
      child.on('close', (exitCode) => {
        const lines = output
          .split('\n')
          .filter((line) => line.startsWith('{"level"'))
          .map((line) => JSON.parse(line) as LogLine);
        resolve({ exitCode, lines });
      });
    });
  }

  it('exception: ghi log fatal JSON kèm stack, tiến trình vẫn dừng với exit code 1', async () => {
    const { exitCode, lines } = await runCrash(
      "setTimeout(() => { throw new Error('hỏng hẳn'); }, 0);",
    );
    assert.equal(exitCode, 1);
    const [line] = lines;
    assert.equal(line?.['level'], 'fatal');
    assert.equal(line?.['origin'], 'uncaughtException');
    assert.match(JSON.stringify(line), /hỏng hẳn/);
  });

  it('promise reject không có catch cũng được ghi', async () => {
    const { exitCode, lines } = await runCrash("Promise.reject(new Error('reject bỏ quên'));");
    assert.equal(exitCode, 1);
    assert.equal(lines[0]?.['origin'], 'unhandledRejection');
    assert.match(JSON.stringify(lines[0]), /reject bỏ quên/);
  });
});
