import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-015: bảng property_images. Thiết kế: docs/database.md mục 4.4.
 * - File nằm trên S3/R2; bảng chỉ lưu key. Key phải nằm dưới `{tenant_id}/properties/{property_id}/`
 *   để ảnh của công ty này không trỏ được sang thư mục công ty khác.
 * - Định dạng cho phép theo quy ước API: jpeg, png, webp, heic.
 * - Mỗi BĐS tối đa một ảnh bìa (bỏ qua ảnh đã soft delete).
 * - Xoá cứng BĐS còn ảnh bị chặn, để không bỏ sót file trên storage.
 */
export class CreatePropertyImages1791096412946 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE property_images (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        property_id uuid NOT NULL,
        storage_key varchar(500) NOT NULL,
        thumbnail_key varchar(500) NULL,
        mime_type varchar(50) NOT NULL,
        size_bytes integer NOT NULL,
        width integer NULL,
        height integer NULL,
        sort_order integer NOT NULL DEFAULT 0,
        is_cover boolean NOT NULL DEFAULT false,
        created_by uuid NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz NULL,
        CONSTRAINT pk_property_images PRIMARY KEY (id),
        CONSTRAINT uq_property_images_storage_key UNIQUE (storage_key),
        CONSTRAINT fk_property_images_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT fk_property_images_property_id FOREIGN KEY (tenant_id, property_id)
          REFERENCES properties (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_property_images_created_by FOREIGN KEY (tenant_id, created_by)
          REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_property_images_storage_key_prefix CHECK (
          starts_with(storage_key, tenant_id::text || '/properties/' || property_id::text || '/')
          AND length(storage_key) > length(tenant_id::text || '/properties/' || property_id::text || '/')
        ),
        CONSTRAINT ck_property_images_thumbnail_key_prefix CHECK (
          starts_with(thumbnail_key, tenant_id::text || '/properties/' || property_id::text || '/')
          AND length(thumbnail_key) > length(tenant_id::text || '/properties/' || property_id::text || '/')
        ),
        CONSTRAINT ck_property_images_mime_type
          CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
        CONSTRAINT ck_property_images_size_bytes CHECK (size_bytes > 0),
        CONSTRAINT ck_property_images_dimensions CHECK (
          (width IS NULL OR width > 0) AND (height IS NULL OR height > 0)
        ),
        CONSTRAINT ck_property_images_sort_order CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_property_images_cover ON property_images (property_id)
        WHERE is_cover AND deleted_at IS NULL
    `);
    await queryRunner.query(
      `CREATE INDEX idx_property_images_property_id ON property_images (property_id, sort_order)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE property_images`);
  }
}
