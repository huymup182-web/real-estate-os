import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import {
  Controller,
  ForbiddenException,
  Get,
  type INestApplication,
  Module,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { Public } from '../src/auth/public.decorator.js';
import { AppModule } from '../src/app.module.js';
import { AppException } from '../src/common/errors/app.exception.js';
import { ErrorCode } from '../src/common/errors/error-code.js';
import { MissingTenantError } from '../src/database/tenant.repository.js';
import { useTestDatabase } from './support/test-database.js';

/** Controller chỉ dùng cho test: mỗi route ném một loại lỗi. */
@Public()
@Controller('test-errors')
class ThrowingController {
  constructor(private readonly dataSource: DataSource) {}

  @Get('app')
  app(): never {
    throw new AppException(ErrorCode.VALIDATION_ERROR, 'Giá không hợp lệ', [
      { field: 'price', message: 'price phải >= 0' },
    ]);
  }

  @Get('business')
  business(): never {
    throw new AppException(ErrorCode.BUSINESS_RULE_VIOLATION);
  }

  @Get('not-found')
  notFound(): never {
    throw new NotFoundException('Owner abc not found');
  }

  @Get('forbidden')
  forbidden(): never {
    throw new ForbiddenException();
  }

  @Get('crash')
  crash(): never {
    throw new Error('mật khẩu database lộ ra ở đây');
  }

  @Get('missing-tenant')
  async missingTenant(): Promise<never> {
    return Promise.reject(new MissingTenantError());
  }

  @Get('db-unique')
  async dbUnique(): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO companies (name, slug) VALUES ('Một', 'trung-slug'), ('Hai', 'trung-slug')`,
    );
  }

  @Get('db-fk')
  async dbForeignKey(): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO owners (tenant_id, full_name, phone) VALUES (gen_random_uuid(), 'A', '+84900000000')`,
    );
  }

  @Get('db-check')
  async dbCheck(): Promise<void> {
    await this.dataSource.query(`INSERT INTO companies (name, slug) VALUES ('Ba', 'SAI SLUG')`);
  }

  @Get('db-invalid-uuid')
  async dbInvalidUuid(): Promise<void> {
    await this.dataSource.query(`SELECT * FROM companies WHERE id = $1`, ['khong-phai-uuid']);
  }

  @Get('db-syntax')
  async dbSyntax(): Promise<void> {
    await this.dataSource.query(`SELEC 1`);
  }

  @Post('echo')
  echo(): { ok: true } {
    return { ok: true };
  }
}

@Module({ imports: [AppModule], controllers: [ThrowingController] })
class TestAppModule {}

interface ErrorBody {
  success: boolean;
  data: unknown;
  message: string;
  error: { code: string; details?: unknown; requestId: string };
}

describe('Xử lý lỗi chung', () => {
  let app: INestApplication;
  let baseUrl: string;

  before(async () => {
    await useTestDatabase();
    app = await createApp(TestAppModule);
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  });

  after(async () => {
    await app.close();
  });

  async function call(
    path: string,
    init?: RequestInit,
  ): Promise<{ status: number; body: ErrorBody; requestId: string | null; raw: string }> {
    const response = await fetch(`${baseUrl}${path}`, init);
    const raw = await response.text();
    return {
      status: response.status,
      body: JSON.parse(raw) as ErrorBody,
      requestId: response.headers.get('x-request-id'),
      raw,
    };
  }

  function assertError(
    result: { status: number; body: ErrorBody; requestId: string | null },
    status: number,
    code: ErrorCode,
  ): void {
    assert.equal(result.status, status);
    assert.equal(result.body.success, false);
    assert.equal(result.body.data, null);
    assert.equal(result.body.error.code, code);
    assert.equal(typeof result.body.message, 'string');
    assert.ok(result.body.message.length > 0);
    assert.ok(result.body.error.requestId);
    assert.equal(result.body.error.requestId, result.requestId);
  }

  it('route không tồn tại → 404 NOT_FOUND đúng định dạng', async () => {
    const result = await call('/khong-ton-tai');
    assertError(result, 404, ErrorCode.NOT_FOUND);
    assert.equal(result.body.message, 'Không tìm thấy dữ liệu');
    assert.ok(!result.raw.includes('Cannot GET'));
  });

  it('AppException trả mã, câu thông báo và details', async () => {
    const result = await call('/test-errors/app');
    assertError(result, 400, ErrorCode.VALIDATION_ERROR);
    assert.equal(result.body.message, 'Giá không hợp lệ');
    assert.deepEqual(result.body.error.details, [{ field: 'price', message: 'price phải >= 0' }]);
  });

  it('AppException không truyền câu thông báo dùng câu mặc định, không có details', async () => {
    const result = await call('/test-errors/business');
    assertError(result, 422, ErrorCode.BUSINESS_RULE_VIOLATION);
    assert.equal(result.body.message, 'Thao tác vi phạm quy tắc nghiệp vụ');
    assert.equal('details' in result.body.error, false);
  });

  it('HttpException có sẵn của NestJS đổi sang mã lỗi theo status', async () => {
    const notFound = await call('/test-errors/not-found');
    assertError(notFound, 404, ErrorCode.NOT_FOUND);
    assert.ok(!notFound.raw.includes('Owner abc'));
    assertError(await call('/test-errors/forbidden'), 403, ErrorCode.FORBIDDEN);
  });

  it('lỗi không lường trước → 500 INTERNAL_ERROR, không lộ stack hay câu lỗi gốc', async () => {
    for (const path of [
      '/test-errors/crash',
      '/test-errors/missing-tenant',
      '/test-errors/db-syntax',
    ]) {
      const result = await call(path);
      assertError(result, 500, ErrorCode.INTERNAL_ERROR);
      assert.equal(result.body.message, 'Có lỗi hệ thống, vui lòng thử lại sau');
      assert.ok(!result.raw.includes('mật khẩu'));
      assert.ok(!result.raw.includes('at '));
      assert.ok(!result.raw.includes('SELEC'));
    }
  });

  it('lỗi database đổi sang mã lỗi API, không lộ tên constraint', async () => {
    const unique = await call('/test-errors/db-unique');
    assertError(unique, 409, ErrorCode.CONFLICT);
    const foreignKey = await call('/test-errors/db-fk');
    assertError(foreignKey, 409, ErrorCode.CONFLICT);
    const check = await call('/test-errors/db-check');
    assertError(check, 400, ErrorCode.VALIDATION_ERROR);
    const invalidUuid = await call('/test-errors/db-invalid-uuid');
    assertError(invalidUuid, 400, ErrorCode.VALIDATION_ERROR);
    for (const result of [unique, foreignKey, check, invalidUuid]) {
      assert.ok(!/uq_|fk_|ck_|companies|owners|uuid/i.test(result.raw), result.raw);
    }
  });

  it('JSON sai cú pháp → 400 VALIDATION_ERROR', async () => {
    const result = await call('/test-errors/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":',
    });
    assertError(result, 400, ErrorCode.VALIDATION_ERROR);
  });

  it('dùng lại request id hợp lệ từ client, tự sinh khi thiếu hoặc không an toàn', async () => {
    const reused = await call('/khong-ton-tai', { headers: { 'x-request-id': 'mobile-123.abc' } });
    assert.equal(reused.requestId, 'mobile-123.abc');
    assert.equal(reused.body.error.requestId, 'mobile-123.abc');

    const generated = await call('/khong-ton-tai');
    assert.match(generated.requestId ?? '', /^[0-9a-f-]{36}$/);

    const unsafe = await call('/khong-ton-tai', { headers: { 'x-request-id': 'x<script>' } });
    assert.match(unsafe.requestId ?? '', /^[0-9a-f-]{36}$/);
    assert.equal(unsafe.body.error.requestId, unsafe.requestId);
  });

  it('request thành công cũng có header X-Request-Id', async () => {
    const response = await fetch(`${baseUrl}/test-errors/echo`, { method: 'POST' });
    assert.equal(response.status, 201);
    assert.ok(response.headers.get('x-request-id'));
  });
});
