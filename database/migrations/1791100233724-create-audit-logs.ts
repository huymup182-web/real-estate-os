import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-025: bảng audit_logs (nhật ký thao tác). Thiết kế: docs/database.md mục 4.9.
 * - Chỉ thêm: trigger chặn UPDATE, DELETE và TRUNCATE, kể cả qua khoá ngoại.
 *   Vì vậy công ty/user đã có nhật ký thì không xoá cứng được (ON DELETE RESTRICT).
 * - tenant_id NULL cho thao tác ở cấp nền tảng. User của một công ty chỉ ghi được nhật ký
 *   của chính công ty đó; user nền tảng (tenant_id NULL) ghi được cho mọi công ty.
 * - changes dạng {field: [cũ, mới]}; backend chịu trách nhiệm không bao giờ ghi mật khẩu/token.
 * - Index tra cứu làm ở TASK-026.
 */
export class CreateAuditLogs1791100233724 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE audit_logs (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        tenant_id uuid NULL,
        user_id uuid NULL,
        action varchar(100) NOT NULL,
        entity_type varchar(50) NULL,
        entity_id uuid NULL,
        changes jsonb NULL,
        ip_address inet NULL,
        user_agent text NULL,
        request_id varchar(100) NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_audit_logs PRIMARY KEY (id),
        CONSTRAINT fk_audit_logs_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT fk_audit_logs_user_id FOREIGN KEY (user_id)
          REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT ck_audit_logs_action_format
          CHECK (action ~ '^[a-z][a-z_]*(\\.[a-z][a-z_]*)+$'),
        CONSTRAINT ck_audit_logs_entity_type_not_blank CHECK (btrim(entity_type) <> ''),
        CONSTRAINT ck_audit_logs_entity_id_requires_type
          CHECK (entity_id IS NULL OR entity_type IS NOT NULL),
        CONSTRAINT ck_audit_logs_changes_object CHECK (jsonb_typeof(changes) = 'object')
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_audit_logs_user_id ON audit_logs (user_id)`);

    await queryRunner.query(`
      CREATE FUNCTION check_audit_logs_tenant() RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
          user_tenant uuid;
        BEGIN
          IF NEW.user_id IS NULL THEN
            RETURN NEW;
          END IF;
          SELECT tenant_id INTO user_tenant FROM users WHERE id = NEW.user_id;
          IF user_tenant IS NOT NULL AND user_tenant IS DISTINCT FROM NEW.tenant_id THEN
            RAISE EXCEPTION 'audit_logs_tenant_mismatch: user công ty chỉ ghi nhật ký của công ty mình'
              USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END;
        $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_audit_logs_check_tenant
        BEFORE INSERT ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION check_audit_logs_tenant()
    `);

    await queryRunner.query(`
      CREATE FUNCTION prevent_audit_logs_change() RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RAISE EXCEPTION 'audit_logs_append_only: nhật ký thao tác không được sửa hoặc xoá'
            USING ERRCODE = 'restrict_violation';
        END;
        $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_audit_logs_append_only
        BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION prevent_audit_logs_change()
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_audit_logs_no_truncate
        BEFORE TRUNCATE ON audit_logs
        FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_logs_change()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE audit_logs`);
    await queryRunner.query(`DROP FUNCTION prevent_audit_logs_change()`);
    await queryRunner.query(`DROP FUNCTION check_audit_logs_tenant()`);
  }
}
