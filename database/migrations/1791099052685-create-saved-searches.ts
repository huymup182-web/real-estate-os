import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-021: bảng saved_searches (tìm kiếm đã lưu). Thiết kế: docs/database.md mục 4.6.
 * - filters là object JSON cùng cấu trúc bộ lọc của API tìm kiếm (backend kiểm chi tiết).
 * - notify = true: báo cho user khi có BĐS mới khớp (Phase 8).
 * - User dùng khoá ngoại kép (tenant_id, user_id); xoá cứng user thì xoá tìm kiếm đã lưu.
 */
export class CreateSavedSearches1791099052685 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE saved_searches (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        user_id uuid NOT NULL,
        name varchar(100) NOT NULL,
        filters jsonb NOT NULL,
        notify boolean NOT NULL DEFAULT true,
        last_notified_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz NULL,
        CONSTRAINT pk_saved_searches PRIMARY KEY (id),
        CONSTRAINT fk_saved_searches_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT fk_saved_searches_user_id FOREIGN KEY (tenant_id, user_id)
          REFERENCES users (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT ck_saved_searches_name_not_blank CHECK (btrim(name) <> ''),
        CONSTRAINT ck_saved_searches_filters_object CHECK (jsonb_typeof(filters) = 'object')
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_saved_searches_user_id ON saved_searches (user_id)
        WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_saved_searches_updated_at
        BEFORE UPDATE ON saved_searches
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE saved_searches`);
  }
}
