import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  type INestApplication,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { IsOptional, IsString } from 'class-validator';
import { Column, DataSource, Entity, Repository } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { AppModule } from '../src/app.module.js';
import { TenantId } from '../src/auth/tenant.guard.js';
import { ParseUuidPipe } from '../src/common/validation/parse-uuid.pipe.js';
import { TenantEntity } from '../src/database/tenant-entity.js';
import { TenantRepository } from '../src/database/tenant.repository.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

/** Entity chỉ dùng cho test, ánh xạ bảng owners có sẵn. */
@Entity({ name: 'owners' })
class IsolationOwner extends TenantEntity {
  @Column({ type: 'varchar' })
  fullName!: string;

  @Column({ type: 'varchar' })
  phone!: string;
}

class OwnerBody {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

/** CRUD mẫu theo đúng cách module nghiệp vụ sẽ làm: tenantId chỉ lấy từ @TenantId(). */
@Controller('test-owners')
class OwnersTestController {
  private readonly owners: TenantRepository<IsolationOwner>;

  constructor(@InjectRepository(IsolationOwner) repository: Repository<IsolationOwner>) {
    this.owners = new TenantRepository(repository);
  }

  @Get()
  list(@TenantId() tenantId: string): Promise<IsolationOwner[]> {
    return this.owners.find(tenantId);
  }

  @Get(':id')
  async get(
    @TenantId() tenantId: string,
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<IsolationOwner> {
    const owner = await this.owners.findById(tenantId, id);
    if (!owner) {
      throw new NotFoundException();
    }
    return owner;
  }

  @Post()
  create(@TenantId() tenantId: string, @Body() body: OwnerBody): Promise<IsolationOwner> {
    return this.owners.create(tenantId, {
      fullName: body.fullName ?? 'Chủ nhà',
      phone: body.phone ?? '+84900000000',
    });
  }

  @Patch(':id')
  async update(
    @TenantId() tenantId: string,
    @Param('id', ParseUuidPipe) id: string,
    @Body() body: OwnerBody,
  ): Promise<IsolationOwner> {
    const owner = await this.owners.update(tenantId, id, body);
    if (!owner) {
      throw new NotFoundException();
    }
    return owner;
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @TenantId() tenantId: string,
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<void> {
    if (!(await this.owners.softDelete(tenantId, id))) {
      throw new NotFoundException();
    }
  }
}

@Module({
  imports: [AppModule, TypeOrmModule.forFeature([IsolationOwner])],
  controllers: [OwnersTestController],
})
class TestAppModule {}

interface Owner {
  id: string;
  tenantId: string;
  fullName: string;
}

describe('Tenant isolation (TASK-047)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  const company: Record<'A' | 'B', { id: string; userId: string; token: string }> = {
    A: { id: '', userId: '', token: '' },
    B: { id: '', userId: '', token: '' },
  };
  let ownerA: Owner;
  let ownerB: Owner;

  before(async () => {
    await useTestDatabase();
    app = await createApp(TestAppModule);
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    db = app.get(DataSource);

    for (const key of ['A', 'B'] as const) {
      const email = `tenant-${key.toLowerCase()}@test.vn`;
      const registered = await call('POST', '/auth/register', undefined, {
        companyName: `Công ty ${key}`,
        fullName: `Admin ${key}`,
        email,
        password: PASSWORD,
      });
      assert.equal(registered.status, 201);
      const data = registered.data as { user: { id: string }; company: { id: string } };
      const login = await call('POST', '/auth/login', undefined, {
        identifier: email,
        password: PASSWORD,
      });
      company[key] = {
        id: data.company.id,
        userId: data.user.id,
        token: (login.data as { accessToken: string }).accessToken,
      };
    }
    ownerA = (await call('POST', '/test-owners', 'A', { fullName: 'Chủ nhà A' })).data as Owner;
    ownerB = (await call('POST', '/test-owners', 'B', { fullName: 'Chủ nhà B' })).data as Owner;
  });

  after(async () => {
    await app.close();
  });

  async function call(
    method: string,
    path: string,
    as?: 'A' | 'B' | string,
    payload?: unknown,
  ): Promise<{ status: number; data: unknown; code?: string; message?: string }> {
    const token = as === 'A' || as === 'B' ? company[as].token : as;
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    if (response.status === 204) {
      return { status: 204, data: null };
    }
    const body = (await response.json()) as {
      data: unknown;
      message: string | null;
      error?: { code: string };
    };
    return {
      status: response.status,
      data: body.data,
      code: body.error?.code,
      message: body.message ?? undefined,
    };
  }

  it('bản ghi tạo ra gắn tenant của người tạo (lấy từ token)', () => {
    assert.equal(ownerA.tenantId, company.A.id);
    assert.equal(ownerB.tenantId, company.B.id);
  });

  it('công ty A chỉ thấy dữ liệu của mình trong danh sách', async () => {
    const listA = (await call('GET', '/test-owners', 'A')).data as Owner[];
    assert.deepEqual(
      listA.map((owner) => owner.id),
      [ownerA.id],
    );
    const listB = (await call('GET', '/test-owners', 'B')).data as Owner[];
    assert.deepEqual(
      listB.map((owner) => owner.id),
      [ownerB.id],
    );
  });

  it('công ty A không đọc, sửa, xoá được dữ liệu công ty B (404, không lộ tồn tại)', async () => {
    assert.equal((await call('GET', `/test-owners/${ownerB.id}`, 'A')).status, 404);
    assert.equal(
      (await call('PATCH', `/test-owners/${ownerB.id}`, 'A', { fullName: 'Bị sửa' })).status,
      404,
    );
    assert.equal((await call('DELETE', `/test-owners/${ownerB.id}`, 'A')).status, 404);

    const [row] = (await db.query('SELECT full_name, deleted_at FROM owners WHERE id = $1', [
      ownerB.id,
    ])) as { full_name: string; deleted_at: Date | null }[];
    assert.equal(row?.full_name, 'Chủ nhà B', 'dữ liệu B không đổi');
    assert.equal(row?.deleted_at, null, 'dữ liệu B không bị xoá');
  });

  it('không gửi được tenantId qua body để ghi sang công ty khác', async () => {
    const created = await call('POST', '/test-owners', 'A', {
      fullName: 'X',
      tenantId: company.B.id,
    });
    assert.equal(created.status, 400);
    const updated = await call('PATCH', `/test-owners/${ownerA.id}`, 'A', {
      tenantId: company.B.id,
    });
    assert.equal(updated.status, 400);
  });

  it('công ty B vẫn đọc, sửa, xoá được dữ liệu của chính mình', async () => {
    assert.equal((await call('GET', `/test-owners/${ownerB.id}`, 'B')).status, 200);
    const updated = await call('PATCH', `/test-owners/${ownerB.id}`, 'B', { fullName: 'B mới' });
    assert.equal((updated.data as Owner).fullName, 'B mới');
    const extra = (await call('POST', '/test-owners', 'B', { fullName: 'Tạm' })).data as Owner;
    assert.equal((await call('DELETE', `/test-owners/${extra.id}`, 'B')).status, 204);
  });

  it('khoá user hoặc tạm ngưng công ty có hiệu lực ngay với access token đang dùng', async () => {
    const cases: [string, string, string, string][] = [
      [
        `UPDATE users SET status = 'LOCKED' WHERE id = $1`,
        `UPDATE users SET status = 'ACTIVE' WHERE id = $1`,
        company.A.userId,
        'Tài khoản đã bị khoá hoặc ngừng hoạt động',
      ],
      [
        `UPDATE companies SET status = 'SUSPENDED' WHERE id = $1`,
        `UPDATE companies SET status = 'ACTIVE' WHERE id = $1`,
        company.A.id,
        'Công ty đang bị tạm ngưng',
      ],
    ];
    for (const [apply, restore, id, message] of cases) {
      await db.query(apply, [id]);
      try {
        const result = await call('GET', '/test-owners', 'A');
        assert.equal(result.status, 403, apply);
        assert.equal(result.code, 'FORBIDDEN');
        assert.equal(result.message, message);
        assert.equal(
          (await call('GET', '/test-owners', 'B')).status,
          200,
          'công ty khác không bị ảnh hưởng',
        );
      } finally {
        await db.query(restore, [id]);
      }
    }
    assert.equal((await call('GET', '/test-owners', 'A')).status, 200);
  });

  it('user đã xoá hoặc đã chuyển sang công ty khác → token cũ không dùng được (401)', async () => {
    await db.query('UPDATE users SET deleted_at = now() WHERE id = $1', [company.A.userId]);
    try {
      assert.equal((await call('GET', '/test-owners', 'A')).status, 401);
    } finally {
      await db.query('UPDATE users SET deleted_at = NULL WHERE id = $1', [company.A.userId]);
    }
    // Giả lập user A bị chuyển sang công ty B: token cũ vẫn mang tenant A.
    await db.query('DELETE FROM user_roles WHERE user_id = $1', [company.A.userId]);
    await db.query('UPDATE users SET tenant_id = $2 WHERE id = $1', [
      company.A.userId,
      company.B.id,
    ]);
    try {
      const result = await call('GET', '/test-owners', 'A');
      assert.equal(result.status, 401);
    } finally {
      await db.query('UPDATE users SET tenant_id = $2 WHERE id = $1', [
        company.A.userId,
        company.A.id,
      ]);
    }
  });

  it('tài khoản nền tảng không truy cập được dữ liệu công ty (403)', async () => {
    const { hashPassword } = await import('../src/auth/password.js');
    await db.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES (NULL, 'platform-iso@test.vn', $1, 'Nền tảng')`,
      [await hashPassword(PASSWORD)],
    );
    const login = await call('POST', '/auth/login', undefined, {
      identifier: 'platform-iso@test.vn',
      password: PASSWORD,
    });
    const token = (login.data as { accessToken: string }).accessToken;
    const result = await call('GET', '/test-owners', token);
    assert.equal(result.status, 403);
    assert.equal(result.message, 'Tài khoản nền tảng không truy cập được dữ liệu của công ty');
  });
});
