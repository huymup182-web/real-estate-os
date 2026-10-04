import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import {
  Body,
  Controller,
  Get,
  type INestApplication,
  Module,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

import { createApp } from '../src/app.factory.js';
import { AppModule } from '../src/app.module.js';
import { ErrorCode } from '../src/common/errors/error-code.js';
import { NoHtml } from '../src/common/validation/no-html.decorator.js';
import { ParseUuidPipe } from '../src/common/validation/parse-uuid.pipe.js';
import { useTestDatabase } from './support/test-database.js';

class AddressDto {
  @IsString()
  @MaxLength(100)
  street!: string;
}

class CreateItemDto {
  @IsString()
  @MaxLength(20)
  @NoHtml()
  name!: string;

  @IsInt()
  @Min(0)
  price!: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;
}

class ListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

/** Controller chỉ dùng cho test: trả lại dữ liệu đã qua validation. */
@Controller('test-validation')
class ValidationController {
  @Post()
  create(@Body() dto: CreateItemDto): { isDto: boolean; dto: CreateItemDto } {
    return { isDto: dto instanceof CreateItemDto, dto };
  }

  @Get()
  list(@Query() query: ListQueryDto): { page: unknown; type: string } {
    return { page: query.page, type: typeof query.page };
  }

  @Get(':id')
  findOne(@Param('id', ParseUuidPipe) id: string): { id: string } {
    return { id };
  }
}

@Module({ imports: [AppModule], controllers: [ValidationController] })
class TestAppModule {}

interface Body {
  success?: boolean;
  message?: string;
  error?: { code: string; details?: { field?: string; message: string }[] };
  [key: string]: unknown;
}

describe('Kiểm tra dữ liệu request', () => {
  let app: INestApplication;
  let baseUrl: string;

  before(async () => {
    await useTestDatabase();
    app = await createApp(TestAppModule);
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1/test-validation`;
  });

  after(async () => {
    await app.close();
  });

  async function post(payload: unknown): Promise<{ status: number; body: Body }> {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: (await response.json()) as Body };
  }

  function fields(body: Body): (string | undefined)[] {
    return (body.error?.details ?? []).map((detail) => detail.field);
  }

  function assertValidationError(result: { status: number; body: Body }): void {
    assert.equal(result.status, 400);
    assert.equal(result.body.success, false);
    assert.equal(result.body.error?.code, ErrorCode.VALIDATION_ERROR);
    assert.equal(result.body.message, 'Dữ liệu không hợp lệ');
    assert.ok((result.body.error?.details ?? []).length > 0);
  }

  it('dữ liệu hợp lệ đi qua và được đổi thành instance của DTO', async () => {
    const result = await post({
      name: 'Nhà phố',
      price: 5000000000,
      address: { street: 'Lê Lợi' },
    });
    assert.equal(result.status, 201);
    const data = result.body['data'] as { isDto: boolean; dto: unknown };
    assert.equal(data.isDto, true);
    assert.deepEqual(data.dto, {
      name: 'Nhà phố',
      price: 5000000000,
      address: { street: 'Lê Lợi' },
    });
  });

  it('thiếu hoặc sai kiểu → 400 kèm lỗi theo từng trường', async () => {
    const result = await post({ price: -1 });
    assertValidationError(result);
    assert.deepEqual([...new Set(fields(result.body))].sort(), ['name', 'price']);
  });

  it('trường không khai báo trong DTO (kể cả tenantId) bị từ chối', async () => {
    const result = await post({
      name: 'A',
      price: 1,
      tenantId: '00000000-0000-0000-0000-000000000001',
    });
    assertValidationError(result);
    assert.deepEqual(fields(result.body), ['tenantId']);
  });

  it('lỗi ở object lồng nhau ghi đường dẫn trường đầy đủ', async () => {
    const result = await post({ name: 'A', price: 1, address: { street: 5, extra: true } });
    assertValidationError(result);
    assert.deepEqual([...new Set(fields(result.body))].sort(), ['address.extra', 'address.street']);
  });

  it('từ chối chuỗi chứa HTML và chuỗi quá dài', async () => {
    const html = await post({ name: '<b>x</b>', price: 1 });
    assertValidationError(html);
    assert.deepEqual(html.body.error?.details, [
      { field: 'name', message: 'name không được chứa HTML' },
    ]);
    assertValidationError(await post({ name: 'x'.repeat(21), price: 1 }));
    assert.equal((await post({ name: 'giá 3 < 5', price: 1 })).status, 201);
  });

  it('body không phải object → 400', async () => {
    assertValidationError(await post(['a']));
  });

  it('không trả lại giá trị client gửi trong lỗi', async () => {
    const result = await post({ name: 'x'.repeat(21) + 'BI-MAT', price: 1 });
    assertValidationError(result);
    assert.ok(!JSON.stringify(result.body).includes('BI-MAT'));
  });

  it('query string được đổi kiểu theo DTO và kiểm tra', async () => {
    const ok = await fetch(`${baseUrl}?page=2`);
    assert.equal(ok.status, 200);
    assert.deepEqual(((await ok.json()) as Body)['data'], { page: 2, type: 'number' });

    const bad = await fetch(`${baseUrl}?page=0`);
    const body = (await bad.json()) as Body;
    assertValidationError({ status: bad.status, body });
    assert.deepEqual(fields(body), ['page']);

    const unknown = await fetch(`${baseUrl}?sortBy=price`);
    assert.equal(unknown.status, 400);
  });

  it('tham số đường dẫn phải là UUID', async () => {
    const id = '3f1e6c1a-2b7d-4c3e-9a51-0d2f6b8e7c41';
    const ok = await fetch(`${baseUrl}/${id}`);
    assert.equal(ok.status, 200);
    assert.deepEqual(((await ok.json()) as Body)['data'], { id });

    const bad = await fetch(`${baseUrl}/khong-phai-uuid`);
    const body = (await bad.json()) as Body;
    assertValidationError({ status: bad.status, body });
    assert.deepEqual(body.error?.details, [{ field: 'id', message: 'id phải là UUID' }]);
  });
});
