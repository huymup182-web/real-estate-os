import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-061: link chia sẻ BĐS cho khách (mở không cần đăng nhập).
 * - Chỉ lưu SHA-256 (hex) của token; token gốc chỉ trả một lần khi tạo.
 * - Link có hạn (`expires_at`) và thu hồi được (`revoked_at`); `view_count` đếm số lần khách mở.
 * - BĐS và người tạo dùng khoá ngoại kép (tenant_id, id). Xoá cứng BĐS thì xoá link theo.
 */
export class CreatePropertyShareLinks1791129000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE property_share_links (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        property_id uuid NOT NULL,
        token_hash char(64) NOT NULL,
        created_by uuid NULL,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz NULL,
        view_count integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_property_share_links PRIMARY KEY (id),
        CONSTRAINT uq_property_share_links_token_hash UNIQUE (token_hash),
        CONSTRAINT fk_property_share_links_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT fk_property_share_links_property_id FOREIGN KEY (tenant_id, property_id)
          REFERENCES properties (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_property_share_links_created_by FOREIGN KEY (tenant_id, created_by)
          REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_property_share_links_token_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_property_share_links_expires_at CHECK (expires_at > created_at),
        CONSTRAINT ck_property_share_links_view_count CHECK (view_count >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_property_share_links_property_id
         ON property_share_links (tenant_id, property_id, created_at DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE property_share_links`);
  }
}
