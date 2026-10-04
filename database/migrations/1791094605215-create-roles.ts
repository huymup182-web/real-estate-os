import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-009: bảng roles và user_roles. Thiết kế: docs/database.md mục 4.2.
 * - roles.tenant_id NULL = role cấp nền tảng (SUPER_ADMIN); còn lại là role riêng của từng công ty.
 * - user_roles gán nhiều role cho một user; trigger đảm bảo user, role và tenant_id cùng một công ty.
 */
export class CreateRoles1791094605215 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE roles (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        tenant_id uuid NULL,
        code varchar(50) NOT NULL,
        name varchar(100) NOT NULL,
        description text NULL,
        is_system boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz NULL,
        CONSTRAINT pk_roles PRIMARY KEY (id),
        CONSTRAINT uq_roles_tenant_id_id UNIQUE (tenant_id, id),
        CONSTRAINT fk_roles_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT ck_roles_code_format CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
        CONSTRAINT ck_roles_name_not_blank CHECK (btrim(name) <> '')
      )
    `);
    // NULLS NOT DISTINCT: hai role nền tảng (tenant_id NULL) cũng không được trùng code
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_roles_tenant_id_code ON roles (tenant_id, code)
        NULLS NOT DISTINCT WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_roles_updated_at
        BEFORE UPDATE ON roles
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);

    await queryRunner.query(`
      CREATE TABLE user_roles (
        user_id uuid NOT NULL,
        role_id uuid NOT NULL,
        tenant_id uuid NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_user_roles PRIMARY KEY (user_id, role_id),
        CONSTRAINT fk_user_roles_user_id FOREIGN KEY (user_id)
          REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_user_roles_role_id FOREIGN KEY (role_id)
          REFERENCES roles (id) ON DELETE RESTRICT,
        CONSTRAINT fk_user_roles_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_user_roles_role_id ON user_roles (role_id)`);
    await queryRunner.query(`CREATE INDEX idx_user_roles_tenant_id ON user_roles (tenant_id)`);

    // Khoá ngoại kép không kiểm tra được khi tenant_id NULL (role nền tảng), nên dùng trigger
    await queryRunner.query(`
      CREATE FUNCTION check_user_roles_tenant() RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
          user_tenant uuid;
          role_tenant uuid;
        BEGIN
          SELECT tenant_id INTO user_tenant FROM users WHERE id = NEW.user_id;
          SELECT tenant_id INTO role_tenant FROM roles WHERE id = NEW.role_id;
          IF user_tenant IS DISTINCT FROM NEW.tenant_id
             OR role_tenant IS DISTINCT FROM NEW.tenant_id THEN
            RAISE EXCEPTION 'user_roles_tenant_mismatch: user, role và tenant_id phải cùng một công ty'
              USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END;
        $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_user_roles_check_tenant
        BEFORE INSERT OR UPDATE ON user_roles
        FOR EACH ROW EXECUTE FUNCTION check_user_roles_tenant()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE user_roles`);
    await queryRunner.query(`DROP FUNCTION check_user_roles_tenant()`);
    await queryRunner.query(`DROP TABLE roles`);
  }
}
