import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-016: bảng property_documents (giấy tờ pháp lý). Thiết kế: docs/database.md mục 4.4.
 * - Danh sách document_type và định dạng file được Huy Lê duyệt ngày 2026-10-04
 *   (có OWNER_ID_DOCUMENT = CCCD chủ nhà, dữ liệu nhạy cảm, dành sẵn khi cần).
 * - File nằm dưới `{tenant_id}/properties/{property_id}/documents/` trên S3/R2.
 * - Xoá cứng BĐS còn giấy tờ bị chặn, để không bỏ sót file trên storage.
 */
export class CreatePropertyDocuments1791096871613 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE property_documents (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        property_id uuid NOT NULL,
        document_type varchar(30) NOT NULL,
        file_name varchar(255) NOT NULL,
        storage_key varchar(500) NOT NULL,
        mime_type varchar(50) NOT NULL,
        size_bytes integer NOT NULL,
        created_by uuid NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz NULL,
        CONSTRAINT pk_property_documents PRIMARY KEY (id),
        CONSTRAINT uq_property_documents_storage_key UNIQUE (storage_key),
        CONSTRAINT fk_property_documents_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT fk_property_documents_property_id FOREIGN KEY (tenant_id, property_id)
          REFERENCES properties (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_property_documents_created_by FOREIGN KEY (tenant_id, created_by)
          REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_property_documents_document_type CHECK (document_type IN (
          'LAND_CERTIFICATE', 'CONSTRUCTION_PERMIT', 'SURVEY_MAP', 'SALE_CONTRACT',
          'DEPOSIT_CONTRACT', 'BROKERAGE_AGREEMENT', 'OWNER_ID_DOCUMENT', 'OTHER'
        )),
        CONSTRAINT ck_property_documents_file_name_not_blank CHECK (btrim(file_name) <> ''),
        CONSTRAINT ck_property_documents_storage_key_prefix CHECK (
          starts_with(storage_key, tenant_id::text || '/properties/' || property_id::text || '/documents/')
          AND length(storage_key)
            > length(tenant_id::text || '/properties/' || property_id::text || '/documents/')
        ),
        CONSTRAINT ck_property_documents_mime_type CHECK (mime_type IN (
          'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'
        )),
        CONSTRAINT ck_property_documents_size_bytes CHECK (size_bytes > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_property_documents_property_id ON property_documents (property_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE property_documents`);
  }
}
