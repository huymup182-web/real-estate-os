import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, describeTable, insertRow, revertAll } from './helpers.ts';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$test$test';

describe('TASK-015: bảng property_images', () => {
  let db: DataSource;
  let companyA: string;
  let companyB: string;
  let userA: string;
  let userB: string;
  let propertyA: string;
  let propertyB: string;
  let seq = 0;

  before(async () => {
    db = await createCleanTestDataSource();
    await db.runMigrations();
    companyA = String((await insertRow(db, 'companies', { name: 'A', slug: 'cong-ty-a' }))['id']);
    companyB = String((await insertRow(db, 'companies', { name: 'B', slug: 'cong-ty-b' }))['id']);
    userA = await insertUser(companyA);
    userB = await insertUser(companyB);
    const province = String(
      (await insertRow(db, 'provinces', { code: '56', name: 'Khánh Hòa' }))['id'],
    );
    const ward = String(
      (
        await insertRow(db, 'wards', {
          province_id: province,
          code: '22333',
          name: 'Bắc Nha Trang',
        })
      )['id'],
    );
    propertyA = await insertProperty(companyA, userA, province, ward);
    propertyB = await insertProperty(companyB, userB, province, ward);
  });

  after(async () => {
    await db.destroy();
  });

  async function insertUser(tenantId: string): Promise<string> {
    seq += 1;
    const user = await insertRow(db, 'users', {
      tenant_id: tenantId,
      email: `user${seq}@example.com`,
      password_hash: HASH,
      full_name: 'Môi giới',
    });
    return String(user['id']);
  }

  async function insertProperty(
    tenantId: string,
    agentId: string,
    provinceId: string,
    wardId: string,
  ): Promise<string> {
    seq += 1;
    const property = await insertRow(db, 'properties', {
      tenant_id: tenantId,
      code: `BDS-${seq}`,
      title: 'Nhà phố',
      property_type: 'HOUSE',
      price: 1,
      area: 50,
      province_id: provinceId,
      ward_id: wardId,
      agent_id: agentId,
    });
    return String(property['id']);
  }

  function key(tenantId: string, propertyId: string): string {
    seq += 1;
    return `${tenantId}/properties/${propertyId}/${seq}.webp`;
  }

  function insertImage(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    return insertRow(db, 'property_images', {
      tenant_id: companyA,
      property_id: propertyA,
      storage_key: key(companyA, propertyA),
      mime_type: 'image/webp',
      size_bytes: 120_000,
      ...values,
    });
  }

  it('có đủ cột đúng kiểu', async () => {
    assert.deepEqual(await describeTable(db, 'property_images'), [
      ['id', 'uuid', 'NO'],
      ['tenant_id', 'uuid', 'NO'],
      ['property_id', 'uuid', 'NO'],
      ['storage_key', 'character varying', 'NO'],
      ['thumbnail_key', 'character varying', 'YES'],
      ['mime_type', 'character varying', 'NO'],
      ['size_bytes', 'integer', 'NO'],
      ['width', 'integer', 'YES'],
      ['height', 'integer', 'YES'],
      ['sort_order', 'integer', 'NO'],
      ['is_cover', 'boolean', 'NO'],
      ['created_by', 'uuid', 'YES'],
      ['created_at', 'timestamp with time zone', 'NO'],
      ['deleted_at', 'timestamp with time zone', 'YES'],
    ]);
  });

  it('tạo ảnh với giá trị mặc định', async () => {
    const image = await insertImage({ created_by: userA, width: 1280, height: 960 });
    assert.equal(image['sort_order'], 0);
    assert.equal(image['is_cover'], false);
    assert.equal(image['deleted_at'], null);
  });

  it('key ảnh phải nằm trong thư mục của đúng công ty và đúng BĐS', async () => {
    await insertImage({ thumbnail_key: key(companyA, propertyA) });
    await assert.rejects(
      insertImage({ storage_key: key(companyB, propertyA) }),
      /ck_property_images_storage_key_prefix/,
    );
    await assert.rejects(
      insertImage({ storage_key: key(companyA, propertyB) }),
      /ck_property_images_storage_key_prefix/,
    );
    await assert.rejects(
      insertImage({ storage_key: `${companyA}/properties/${propertyA}/` }),
      /ck_property_images_storage_key_prefix/,
    );
    await assert.rejects(
      insertImage({ thumbnail_key: `other/${propertyA}.webp` }),
      /ck_property_images_thumbnail_key_prefix/,
    );
  });

  it('không dùng chung một key cho hai ảnh', async () => {
    const storageKey = key(companyA, propertyA);
    await insertImage({ storage_key: storageKey });
    await assert.rejects(
      insertImage({ storage_key: storageKey }),
      /uq_property_images_storage_key/,
    );
  });

  it('chỉ nhận jpeg/png/webp/heic, kích thước và thứ tự hợp lệ', async () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/heic']) {
      await insertImage({ mime_type: mime });
    }
    await assert.rejects(insertImage({ mime_type: 'image/gif' }), /ck_property_images_mime_type/);
    await assert.rejects(
      insertImage({ mime_type: 'application/pdf' }),
      /ck_property_images_mime_type/,
    );
    await assert.rejects(insertImage({ size_bytes: 0 }), /ck_property_images_size_bytes/);
    await assert.rejects(insertImage({ width: 0 }), /ck_property_images_dimensions/);
    await assert.rejects(insertImage({ sort_order: -1 }), /ck_property_images_sort_order/);
  });

  it('mỗi BĐS tối đa một ảnh bìa; ảnh bìa đã xoá thì đặt được ảnh bìa mới', async () => {
    const cover = await insertImage({ is_cover: true });
    await assert.rejects(insertImage({ is_cover: true }), /uq_property_images_cover/);
    await db.query('UPDATE property_images SET deleted_at = now() WHERE id = $1', [cover['id']]);
    await insertImage({ is_cover: true });
    await insertRow(db, 'property_images', {
      tenant_id: companyB,
      property_id: propertyB,
      storage_key: key(companyB, propertyB),
      mime_type: 'image/jpeg',
      size_bytes: 1,
      is_cover: true,
    });
  });

  it('không gắn ảnh vào BĐS hoặc người tạo của công ty khác', async () => {
    await assert.rejects(
      insertImage({ tenant_id: companyB, storage_key: key(companyB, propertyA) }),
      /fk_property_images_property_id/,
    );
    await assert.rejects(insertImage({ created_by: userB }), /fk_property_images_created_by/);
  });

  it('không xoá cứng được BĐS còn ảnh', async () => {
    await assert.rejects(
      db.query('DELETE FROM properties WHERE id = $1', [propertyA]),
      /fk_property_images_property_id/,
    );
  });

  it('revert rồi chạy lại toàn bộ migration sạch', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'property_images'`,
    );
    assert.equal(tables.length, 0);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
