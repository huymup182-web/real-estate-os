import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-008: bảng users. Thiết kế: docs/database.md mục 4.2.
 * - tenant_id NULL chỉ dành cho SUPER_ADMIN cấp nền tảng.
 * - email/phone duy nhất toàn hệ thống (đăng nhập không cần mã công ty), bỏ qua bản ghi đã soft delete.
 * - department_id được thêm ở TASK-011 khi có bảng departments.
 */
export class CreateUsers1791094180613 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE users (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        tenant_id uuid NULL,
        email citext NULL,
        phone varchar(20) NULL,
        password_hash varchar(255) NOT NULL,
        full_name varchar(255) NOT NULL,
        avatar_url text NULL,
        status varchar(20) NOT NULL DEFAULT 'ACTIVE',
        last_login_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz NULL,
        CONSTRAINT pk_users PRIMARY KEY (id),
        CONSTRAINT uq_users_tenant_id_id UNIQUE (tenant_id, id),
        CONSTRAINT fk_users_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT ck_users_email_or_phone CHECK (email IS NOT NULL OR phone IS NOT NULL),
        CONSTRAINT ck_users_email_format CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'),
        CONSTRAINT ck_users_phone_format CHECK (phone ~ '^\\+[0-9]{8,15}$'),
        CONSTRAINT ck_users_password_hash_not_blank CHECK (btrim(password_hash) <> ''),
        CONSTRAINT ck_users_full_name_not_blank CHECK (btrim(full_name) <> ''),
        CONSTRAINT ck_users_status CHECK (status IN ('ACTIVE', 'INACTIVE', 'LOCKED'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_users_email ON users (email) WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_users_phone ON users (phone) WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(`CREATE INDEX idx_users_tenant_id ON users (tenant_id)`);
    await queryRunner.query(`
      CREATE TRIGGER trg_users_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE users`);
  }
}
