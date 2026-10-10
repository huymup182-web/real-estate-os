import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import {
  Controller,
  Delete,
  Get,
  HttpCode,
  type INestApplication,
  Module,
  Post,
  Query,
} from '@nestjs/common';

import { createApp } from '../src/app.factory.js';
import { Public } from '../src/auth/public.decorator.js';
import { AppModule } from '../src/app.module.js';
import { Paginated } from '../src/common/response/paginated.js';
import { PaginationQueryDto } from '../src/common/response/pagination-query.dto.js';
import { useTestDatabase } from './support/test-database.js';

const ITEMS = Array.from({ length: 45 }, (_, index) => ({ id: index + 1 }));

/** Controller chỉ dùng cho test: trả các loại kết quả khác nhau. */
@Public()
@Controller('test-response')
class ResponseController {
  @Get('object')
  object(): { id: string; title: string } {
    return { id: 'a', title: 'Nhà phố' };
  }

  @Get('array')
  array(): number[] {
    return [1, 2];
  }

  @Get('nothing')
  nothing(): void {
    return undefined;
  }

  @Post()
  create(): { id: string } {
    return { id: 'moi' };
  }

  @Delete()
  @HttpCode(204)
  remove(): void {
    return undefined;
  }

  @Get('list')
  list(@Query() query: PaginationQueryDto): Paginated<{ id: number }> {
    const page = ITEMS.slice(query.offset, query.offset + query.pageSize);
    return new Paginated(page, query.page, query.pageSize, ITEMS.length);
  }
}

@Module({ imports: [AppModule], controllers: [ResponseController] })
class TestAppModule {}

describe('Định dạng response thành công', () => {
  let app: INestApplication;
  let baseUrl: string;

  before(async () => {
    await useTestDatabase();
    app = await createApp(TestAppModule);
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1/test-response`;
  });

  after(async () => {
    await app.close();
  });

  async function getJson(path: string, init?: RequestInit): Promise<[number, unknown]> {
    const response = await fetch(`${baseUrl}${path}`, init);
    return [response.status, await response.json()];
  }

  it('bọc object, mảng và kết quả rỗng thành { success, data, message }', async () => {
    assert.deepEqual(await getJson('/object'), [
      200,
      { success: true, data: { id: 'a', title: 'Nhà phố' }, message: null },
    ]);
    assert.deepEqual(await getJson('/array'), [
      200,
      { success: true, data: [1, 2], message: null },
    ]);
    assert.deepEqual(await getJson('/nothing'), [
      200,
      { success: true, data: null, message: null },
    ]);
  });

  it('POST giữ status 201 và cùng định dạng', async () => {
    assert.deepEqual(await getJson('', { method: 'POST' }), [
      201,
      { success: true, data: { id: 'moi' }, message: null },
    ]);
  });

  it('204 không có body', async () => {
    const response = await fetch(baseUrl, { method: 'DELETE' });
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
  });

  it('danh sách phân trang có data và meta', async () => {
    assert.deepEqual(await getJson('/list?page=3&pageSize=20'), [
      200,
      {
        success: true,
        data: ITEMS.slice(40),
        message: null,
        meta: { page: 3, pageSize: 20, total: 45, totalPages: 3 },
      },
    ]);
  });

  it('phân trang mặc định page=1, pageSize=20', async () => {
    const [, body] = await getJson('/list');
    const { data, meta } = body as { data: unknown[]; meta: unknown };
    assert.equal(data.length, 20);
    assert.deepEqual(meta, { page: 1, pageSize: 20, total: 45, totalPages: 3 });
  });

  it('pageSize tối đa 100, page từ 1 đến 10.000', async () => {
    for (const query of [
      'pageSize=101',
      'page=0',
      'pageSize=0',
      'page=abc',
      'page=1.5',
      'page=10001',
      'page=1e20',
      'page=99999999999999999999',
      'page=1&page=2',
    ]) {
      const [status, body] = await getJson(`/list?${query}`);
      assert.equal(status, 400, query);
      assert.equal((body as { error: { code: string } }).error.code, 'VALIDATION_ERROR');
    }
  });

  it('lỗi vẫn theo định dạng lỗi, không bị bọc lại', async () => {
    const [status, body] = await getJson('/khong-ton-tai');
    assert.equal(status, 404);
    const { success, data, error } = body as { success: boolean; data: unknown; error?: unknown };
    assert.equal(success, false);
    assert.equal(data, null);
    assert.ok(error);
  });
});
