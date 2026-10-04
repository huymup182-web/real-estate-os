import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-011: bảng departments và cột users.department_id. Thiết kế: docs/database.md mục 4.2.
 * - Trưởng phòng (manager_id) và phòng ban của user dùng khoá ngoại kép (tenant_id, id),
 *   nên không gắn được user/phòng ban của công ty khác.
 * - User nền tảng (tenant_id NULL) không thuộc phòng ban nào.
 */
export class CreateDepartments1791095262098 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE departments (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        name varchar(255) NOT NULL,
        manager_id uuid NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz NULL,
        CONSTRAINT pk_departments PRIMARY KEY (id),
        CONSTRAINT uq_departments_tenant_id_id UNIQUE (tenant_id, id),
        CONSTRAINT fk_departments_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT fk_departments_manager_id FOREIGN KEY (tenant_id, manager_id)
          REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_departments_name_not_blank CHECK (btrim(name) <> '')
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_departments_tenant_id_name ON departments (tenant_id, name)
        WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`CREATE INDEX idx_departments_manager_id ON departments (manager_id)`);
    await queryRunner.query(`
      CREATE TRIGGER trg_departments_updated_at
        BEFORE UPDATE ON departments
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);

    await queryRunner.query(`ALTER TABLE users ADD COLUMN department_id uuid NULL`);
    // Khoá ngoại kép bỏ qua khi tenant_id NULL, nên cấm user nền tảng có phòng ban bằng CHECK
    await queryRunner.query(`
      ALTER TABLE users
        ADD CONSTRAINT fk_users_department_id FOREIGN KEY (tenant_id, department_id)
          REFERENCES departments (tenant_id, id) ON DELETE RESTRICT,
        ADD CONSTRAINT ck_users_department_requires_tenant
          CHECK (department_id IS NULL OR tenant_id IS NOT NULL)
    `);
    await queryRunner.query(`CREATE INDEX idx_users_department_id ON users (department_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN department_id`);
    await queryRunner.query(`DROP TABLE departments`);
  }
}
