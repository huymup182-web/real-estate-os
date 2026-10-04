import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';

import { Controller, Get, type INestApplication, Logger, Module } from '@nestjs/common';

import { createApp } from '../src/app.factory.js';
import { Public } from '../src/auth/public.decorator.js';
import { AppModule } from '../src/app.module.js';
import { AppLogger, enabledLogLevels } from '../src/common/logging/app-logger.js';
import { getRequestContext } from '../src/common/logging/request-context.js';
import { useTestDatabase } from './support/test-database.js';

type LogLine = Record<string, unknown>;

/** Bắt các dòng log JSON ghi ra stdout/stderr; dòng khác (của test runner) đi tiếp như bình thường. */
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

/** Controller chỉ dùng cho test: ghi log bên trong request. */
@Public()
@Controller('test-logging')
class LoggingController {
  private readonly logger = new Logger('LoggingController');

  @Get('message')
  async message(): Promise<{ ok: true }> {
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.logger.log('trong handler', { propertyId: 7, password: 'mat-khau-123' });
    return { ok: true };
  }

  @Get('with-user')
  withUser(): { ok: true } {
    // Giả lập bước xác thực (TASK-047) gắn tenant và user vào request context.
    const context = getRequestContext();
    assert.ok(context);
    context.tenantId = 'tenant-1';
    context.userId = 'user-1';
    this.logger.log('đã xác thực');
    return { ok: true };
  }

  @Get('crash')
  crash(): never {
    throw new Error('lỗi không lường trước');
  }
}

@Module({ imports: [AppModule], controllers: [LoggingController] })
class TestAppModule {}

describe('Logging', () => {
  let app: INestApplication;
  let baseUrl: string;
  let capture: ReturnType<typeof captureLogs>;

  before(async () => {
    await useTestDatabase();
    capture = captureLogs();
    app = await createApp(TestAppModule);
    app.useLogger(new AppLogger('log'));
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1/test-logging`;
  });

  after(async () => {
    await app.close();
    capture.restore();
  });

  beforeEach(() => {
    capture.lines.length = 0;
  });

  /** Gọi API rồi đợi dòng log request (ghi khi response kết thúc). */
  async function call(path: string): Promise<{ status: number; requestId: string }> {
    const response = await fetch(`${baseUrl}${path}`);
    await response.text();
    const requestId = response.headers.get('x-request-id') ?? '';
    for (let i = 0; i < 50 && !capture.lines.some((l) => l['context'] === 'HTTP'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return { status: response.status, requestId };
  }

  function linesWith(context: string): LogLine[] {
    return capture.lines.filter((line) => line['context'] === context);
  }

  it('ghi một dòng JSON cho mỗi request: method, đường dẫn, status, thời gian, requestId', async () => {
    const { requestId } = await call('/message?phone=0909123456');
    const [line] = linesWith('HTTP');
    assert.ok(line);
    assert.equal(line['level'], 'log');
    assert.equal(line['method'], 'GET');
    assert.equal(line['path'], '/api/v1/test-logging/message');
    assert.equal(line['statusCode'], 200);
    assert.equal(typeof line['durationMs'], 'number');
    assert.ok((line['durationMs'] as number) >= 5);
    assert.equal(line['requestId'], requestId);
    assert.equal(typeof line['timestamp'], 'number');
    assert.ok(!JSON.stringify(capture.lines).includes('0909123456'), 'không ghi query string');
  });

  it('log trong handler tự kèm requestId và che trường nhạy cảm', async () => {
    const { requestId } = await call('/message');
    const [line] = linesWith('LoggingController');
    assert.ok(line);
    assert.equal(line['message'], 'trong handler');
    assert.equal(line['requestId'], requestId);
    assert.equal(line['propertyId'], 7);
    assert.equal(line['password'], '[REDACTED]');
    assert.ok(!JSON.stringify(capture.lines).includes('mat-khau-123'));
  });

  it('kèm tenantId và userId khi request đã xác thực', async () => {
    const { requestId } = await call('/with-user');
    const [line] = linesWith('LoggingController');
    assert.ok(line);
    assert.equal(line['requestId'], requestId);
    assert.equal(line['tenantId'], 'tenant-1');
    assert.equal(line['userId'], 'user-1');
  });

  it('các request không lẫn context của nhau', async () => {
    const results = await Promise.all([call('/message'), call('/message'), call('/message')]);
    const logged = linesWith('LoggingController').map((line) => line['requestId']);
    assert.deepEqual([...logged].sort(), results.map((result) => result.requestId).sort());
  });

  it('lỗi 500 ghi log mức error kèm stack và requestId; client không nhận stack', async () => {
    const response = await fetch(`${baseUrl}/crash`);
    const body = await response.text();
    assert.equal(response.status, 500);
    assert.ok(!body.includes('lỗi không lường trước'));
    const requestId = response.headers.get('x-request-id');
    const [line] = linesWith('ExceptionFilter');
    assert.ok(line);
    assert.equal(line['level'], 'error');
    assert.equal(line['requestId'], requestId);
    const error = line['error'] as { message: string; stack: string };
    assert.equal(error.message, 'lỗi không lường trước');
    assert.match(error.stack, /LoggingController/);
  });
});

describe('Mức log', () => {
  it('bật mức đã chọn và các mức nghiêm trọng hơn', () => {
    assert.deepEqual(enabledLogLevels('warn'), ['fatal', 'error', 'warn']);
    assert.deepEqual(enabledLogLevels('log'), ['fatal', 'error', 'warn', 'log']);
    assert.deepEqual(enabledLogLevels('verbose'), [
      'fatal',
      'error',
      'warn',
      'log',
      'debug',
      'verbose',
    ]);
  });

  it('không ghi mức thấp hơn mức đã chọn; ngoài request thì không có requestId', () => {
    const capture = captureLogs();
    try {
      const logger = new AppLogger('warn');
      logger.log('bị bỏ qua', 'Test');
      logger.warn('được ghi', 'Test');
      assert.equal(capture.lines.length, 1);
      assert.equal(capture.lines[0]?.['message'], 'được ghi');
      assert.equal('requestId' in (capture.lines[0] ?? {}), false);
    } finally {
      capture.restore();
    }
  });
});
