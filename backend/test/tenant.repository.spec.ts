import 'reflect-metadata';

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { Column, DataSource, Entity } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { toSnakeCase } from '../src/database/snake-naming.strategy.js';
import { TenantEntity } from '../src/database/tenant-entity.js';
import { MissingTenantError, TenantRepository } from '../src/database/tenant.repository.js';
import { useTestDatabase } from './support/test-database.js';

/** Entity chỉ dùng cho test, ánh xạ bảng owners có sẵn (entity thật làm ở module properties). */
@Entity({ name: 'owners' })
class TestOwner extends TenantEntity {
  @Column({ type: 'varchar' })
  fullName!: string;

  @Column({ type: 'varchar' })
  phone!: string;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;
}

describe('TenantRepository', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let owners: TenantRepository<TestOwner>;
  let tenantA: string;
  let tenantB: string;

  async function createCompany(slug: string): Promise<string> {
    const rows: { id: string }[] = await dataSource.query(
      'INSERT INTO companies (name, slug) VALUES ($1, $1) RETURNING id',
      [slug],
    );
    return rows[0]?.id ?? '';
  }

  before(async () => {
    await useTestDatabase();
    app = await createApp();
    app.useLogger(false);
    await app.init();
    // Đăng ký entity test vào kết nối đang chạy.
    const base = app.get(DataSource);
    dataSource = new DataSource({ ...base.options, entities: [TestOwner] });
    await dataSource.initialize();
    owners = new TenantRepository(dataSource.getRepository(TestOwner));
    tenantA = await createCompany('cong-ty-a');
    tenantB = await createCompany('cong-ty-b');
  });

  after(async () => {
    await dataSource.destroy();
    await app.close();
  });

  it('đổi tên thuộc tính camelCase sang cột snake_case', () => {
    assert.equal(toSnakeCase('tenantId'), 'tenant_id');
    assert.equal(toSnakeCase('pricePerM2'), 'price_per_m2');
    const columns = dataSource.getMetadata(TestOwner).columns.map((c) => c.databaseName);
    assert.deepEqual(columns.sort(), [
      'created_at',
      'deleted_at',
      'full_name',
      'id',
      'notes',
      'phone',
      'tenant_id',
      'updated_at',
    ]);
  });

  it('tạo bản ghi gắn tenant từ tham số, bỏ qua tenantId/id client gửi lên', async () => {
    const owner = await owners.create(tenantA, {
      fullName: 'Chủ nhà A',
      phone: '+84911111111',
      ...({ tenantId: tenantB, id: '00000000-0000-4000-8000-000000000000' } as object),
    });
    assert.equal(owner.tenantId, tenantA);
    assert.notEqual(owner.id, '00000000-0000-4000-8000-000000000000');
    assert.ok(owner.createdAt instanceof Date);
    assert.equal(owner.deletedAt, null);
  });

  it('chỉ đọc được dữ liệu của tenant mình', async () => {
    const ownerB = await owners.create(tenantB, { fullName: 'Chủ nhà B', phone: '+84922222222' });
    assert.equal(await owners.findById(tenantA, ownerB.id), null);
    assert.equal((await owners.findById(tenantB, ownerB.id))?.fullName, 'Chủ nhà B');
    assert.ok((await owners.find(tenantA)).every((o) => o.tenantId === tenantA));
    assert.equal(await owners.count(tenantB, { phone: '+84922222222' }), 1);
    assert.equal(await owners.count(tenantA, { phone: '+84922222222' }), 0);
    const viaBuilder = await owners.createQueryBuilder(tenantA, 'o').getMany();
    assert.ok(viaBuilder.length > 0 && viaBuilder.every((o) => o.tenantId === tenantA));
    // where()/orWhere() của caller không làm lộ dữ liệu tenant khác.
    const withOr = await owners
      .createQueryBuilder(tenantA, 'o', (query) =>
        query
          .where('o.phone = :b', { b: '+84922222222' })
          .orWhere('o.phone = :a', { a: '+84911111111' }),
      )
      .getMany();
    assert.deepEqual(
      withOr.map((o) => o.phone),
      ['+84911111111'],
    );
  });

  it('không sửa hay xoá được bản ghi của tenant khác, không đổi được tenant', async () => {
    const ownerB = await owners.create(tenantB, { fullName: 'Chủ nhà B2', phone: '+84933333333' });
    assert.equal(await owners.update(tenantA, ownerB.id, { notes: 'sửa trái phép' }), null);
    assert.equal(await owners.softDelete(tenantA, ownerB.id), false);
    const moved = await owners.update(tenantB, ownerB.id, {
      notes: 'ghi chú',
      ...({ tenantId: tenantA } as object),
    });
    assert.equal(moved?.tenantId, tenantB);
    assert.equal(moved?.notes, 'ghi chú');
  });

  it('soft delete: bản ghi đã xoá không còn đọc được nhưng vẫn nằm trong database', async () => {
    const owner = await owners.create(tenantA, { fullName: 'Sẽ xoá', phone: '+84944444444' });
    assert.equal(await owners.softDelete(tenantA, owner.id), true);
    assert.equal(await owners.findById(tenantA, owner.id), null);
    const rows: { deleted_at: Date | null }[] = await dataSource.query(
      'SELECT deleted_at FROM owners WHERE id = $1',
      [owner.id],
    );
    assert.ok(rows[0]?.deleted_at instanceof Date);
  });

  it('truy vấn không có tenant hợp lệ bị chặn', async () => {
    for (const tenantId of ['', 'abc', undefined as unknown as string]) {
      await assert.rejects(owners.find(tenantId), MissingTenantError);
      await assert.rejects(
        owners.create(tenantId, { fullName: 'X', phone: '+84955555555' }),
        MissingTenantError,
      );
      assert.throws(() => owners.createQueryBuilder(tenantId, 'o'), MissingTenantError);
    }
  });

  it('chạy được trong transaction', async () => {
    await assert.rejects(
      dataSource.transaction(async (manager) => {
        await owners
          .withManager(manager)
          .create(tenantA, { fullName: 'Rollback', phone: '+84966666666' });
        throw new Error('huỷ');
      }),
      /huỷ/,
    );
    assert.equal(await owners.count(tenantA, { fullName: 'Rollback' }), 0);
  });
});
