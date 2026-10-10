import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-020: bảng property_favorites và property_views. Thiết kế: docs/database.md mục 4.4.
 * - property_favorites: mỗi user lưu một BĐS tối đa một lần (PK user_id, property_id).
 * - property_views: lượt xem chi tiết, chỉ thêm, không sửa (trigger chặn UPDATE).
 * - User và BĐS dùng khoá ngoại kép (tenant_id, id); xoá cứng user/BĐS thì xoá theo.
 */
export class CreatePropertyFavoritesViews1791098216229 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE property_favorites (
        tenant_id uuid NOT NULL,
        user_id uuid NOT NULL,
        property_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_property_favorites PRIMARY KEY (user_id, property_id),
        CONSTRAINT fk_property_favorites_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT fk_property_favorites_user_id FOREIGN KEY (tenant_id, user_id)
          REFERENCES users (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_property_favorites_property_id FOREIGN KEY (tenant_id, property_id)
          REFERENCES properties (tenant_id, id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_property_favorites_property_id ON property_favorites (property_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE property_views (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        property_id uuid NOT NULL,
        user_id uuid NOT NULL,
        viewed_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_property_views PRIMARY KEY (id),
        CONSTRAINT fk_property_views_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT fk_property_views_property_id FOREIGN KEY (tenant_id, property_id)
          REFERENCES properties (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_property_views_user_id FOREIGN KEY (tenant_id, user_id)
          REFERENCES users (tenant_id, id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_property_views_property_id_viewed_at
        ON property_views (property_id, viewed_at DESC)
    `);
    await queryRunner.query(`CREATE INDEX idx_property_views_user_id ON property_views (user_id)`);

    await queryRunner.query(`
      CREATE FUNCTION prevent_property_views_update() RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RAISE EXCEPTION 'property_views_append_only: lượt xem không được sửa'
            USING ERRCODE = 'restrict_violation';
        END;
        $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_property_views_append_only
        BEFORE UPDATE ON property_views
        FOR EACH ROW EXECUTE FUNCTION prevent_property_views_update()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE property_views`);
    await queryRunner.query(`DROP FUNCTION prevent_property_views_update()`);
    await queryRunner.query(`DROP TABLE property_favorites`);
  }
}
