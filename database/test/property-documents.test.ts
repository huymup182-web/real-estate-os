import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, describeTable, insertRow, revertAll } from './helpers.ts';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$test$test';

describe('TASK-016: bảng property_documents', () => {
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
    return `${tenantId}/properties/${propertyId}/documents/${seq}.pdf`;
  }

  function insertDocument(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    return insertRow(db, 'property_documents', {
      tenant_id: companyA,
      property_id: propertyA,
      document_type: 'LAND_CERTIFICATE',
      file_name: 'so-hong.pdf',
      storage_key: key(companyA, propertyA),
      mime_type: 'application/pdf',
      size_bytes: 250_000,
      ...values,
    });
  }

  it('có đủ cột đúng kiểu', async () => {
    assert.deepEqual(await describeTable(db, 'property_documents'), [
      ['id', 'uuid', 'NO'],
      ['tenant_id', 'uuid', 'NO'],
      ['property_id', 'uuid', 'NO'],
      ['document_type', 'character varying', 'NO'],
      ['file_name', 'character varying', 'NO'],
      ['storage_key', 'character varying', 'NO'],
      ['mime_type', 'character varying', 'NO'],
      ['size_bytes', 'integer', 'NO'],
      ['created_by', 'uuid', 'YES'],
      ['created_at', 'timestamp with time zone', 'NO'],
      ['deleted_at', 'timestamp with time zone', 'YES'],
    ]);
  });

  it('nhận đủ các loại giấy tờ đã duyệt, kể cả CCCD chủ nhà', async () => {
    for (const type of [
      'LAND_CERTIFICATE',
      'CONSTRUCTION_PERMIT',
      'SURVEY_MAP',
      'SALE_CONTRACT',
      'DEPOSIT_CONTRACT',
      'BROKERAGE_AGREEMENT',
      'OWNER_ID_DOCUMENT',
      'OTHER',
    ]) {
      await insertDocument({ document_type: type, created_by: userA });
    }
    await assert.rejects(
      insertDocument({ document_type: 'PASSPORT' }),
      /ck_property_documents_document_type/,
    );
  });

  it('nhận PDF và ảnh chụp giấy tờ, từ chối định dạng khác', async () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/heic']) {
      await insertDocument({ mime_type: mime });
    }
    await assert.rejects(
      insertDocument({ mime_type: 'application/msword' }),
      /ck_property_documents_mime_type/,
    );
    await assert.rejects(insertDocument({ size_bytes: 0 }), /ck_property_documents_size_bytes/);
    await assert.rejects(
      insertDocument({ file_name: ' ' }),
      /ck_property_documents_file_name_not_blank/,
    );
  });

  it('file phải nằm trong thư mục documents của đúng công ty và đúng BĐS, không trùng key', async () => {
    await assert.rejects(
      insertDocument({ storage_key: key(companyB, propertyA) }),
      /ck_property_documents_storage_key_prefix/,
    );
    await assert.rejects(
      insertDocument({ storage_key: `${companyA}/properties/${propertyA}/anh.webp` }),
      /ck_property_documents_storage_key_prefix/,
    );
    await assert.rejects(
      insertDocument({ storage_key: `${companyA}/properties/${propertyA}/documents/` }),
      /ck_property_documents_storage_key_prefix/,
    );
    const storageKey = key(companyA, propertyA);
    await insertDocument({ storage_key: storageKey });
    await assert.rejects(
      insertDocument({ storage_key: storageKey }),
      /uq_property_documents_storage_key/,
    );
  });

  it('không gắn giấy tờ vào BĐS hoặc người tạo của công ty khác', async () => {
    await assert.rejects(
      insertDocument({ property_id: propertyB, storage_key: key(companyA, propertyB) }),
      /fk_property_documents_property_id/,
    );
    await assert.rejects(insertDocument({ created_by: userB }), /fk_property_documents_created_by/);
  });

  it('không xoá cứng được BĐS còn giấy tờ', async () => {
    await insertDocument({});
    await assert.rejects(
      db.query('DELETE FROM properties WHERE id = $1', [propertyA]),
      /fk_property_documents_property_id/,
    );
  });

  it('revert rồi chạy lại toàn bộ migration sạch', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'property_documents'`,
    );
    assert.equal(tables.length, 0);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
