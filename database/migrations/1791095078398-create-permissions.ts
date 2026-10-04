import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-010: bảng permissions và role_permissions. Thiết kế và danh mục quyền MVP: docs/database.md mục 4.2.
 * - permissions là danh mục chung toàn hệ thống (không có tenant_id), thêm quyền mới bằng migration.
 * - role_permissions gán quyền kèm phạm vi dữ liệu (scope) cho role.
 * - Trigger đảm bảo quyền nền tảng và scope PLATFORM chỉ dành cho role nền tảng (tenant_id NULL).
 */

/** [code, mô tả, is_platform]. module = phần trước dấu chấm đầu tiên của code. */
const PERMISSIONS: readonly (readonly [string, string, boolean])[] = [
  ['property.view', 'Xem bất động sản', false],
  ['property.create', 'Tạo bất động sản', false],
  ['property.edit', 'Sửa bất động sản', false],
  ['property.delete', 'Xoá bất động sản', false],
  ['property.approve', 'Duyệt bất động sản', false],
  ['property.view_owner_contact', 'Xem thông tin liên hệ của chủ nhà', false],
  ['property.verify', 'Xác minh lại thông tin bất động sản', false],
  ['property.view_documents', 'Xem giấy tờ pháp lý của bất động sản', false],
  ['customer.view', 'Xem khách hàng', false],
  ['customer.create', 'Tạo khách hàng', false],
  ['customer.edit', 'Sửa khách hàng', false],
  ['customer.assign', 'Phân khách hàng cho nhân viên', false],
  ['customer.delete', 'Xoá khách hàng', false],
  ['user.view', 'Xem người dùng', false],
  ['user.manage', 'Quản lý người dùng', false],
  ['team.view', 'Xem team', false],
  ['team.manage', 'Quản lý team', false],
  ['report.view', 'Xem báo cáo', false],
  ['admin.manage', 'Quản lý role và cài đặt công ty', false],
  ['audit.view', 'Xem nhật ký thao tác', false],
  ['appointment.view', 'Xem lịch hẹn', false],
  ['appointment.manage', 'Quản lý lịch hẹn', false],
  ['deal.view', 'Xem giao dịch', false],
  ['deal.manage', 'Quản lý giao dịch', false],
  ['commission.view', 'Xem hoa hồng', false],
  ['commission.manage', 'Quản lý hoa hồng', false],
  ['platform.company.manage', 'Quản lý các công ty trên nền tảng', true],
];

export class CreatePermissions1791095078398 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE permissions (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        code varchar(100) NOT NULL,
        module varchar(50) NOT NULL,
        description text NOT NULL,
        is_platform boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_permissions PRIMARY KEY (id),
        CONSTRAINT uq_permissions_code UNIQUE (code),
        CONSTRAINT ck_permissions_code_format
          CHECK (code ~ '^[a-z][a-z_]*(\\.[a-z][a-z_]*)+$'),
        CONSTRAINT ck_permissions_module_matches_code
          CHECK (module = split_part(code, '.', 1)),
        CONSTRAINT ck_permissions_description_not_blank CHECK (btrim(description) <> '')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE role_permissions (
        role_id uuid NOT NULL,
        permission_id uuid NOT NULL,
        scope varchar(20) NOT NULL,
        CONSTRAINT pk_role_permissions PRIMARY KEY (role_id, permission_id),
        CONSTRAINT fk_role_permissions_role_id FOREIGN KEY (role_id)
          REFERENCES roles (id) ON DELETE CASCADE,
        CONSTRAINT fk_role_permissions_permission_id FOREIGN KEY (permission_id)
          REFERENCES permissions (id) ON DELETE RESTRICT,
        CONSTRAINT ck_role_permissions_scope
          CHECK (scope IN ('OWN', 'TEAM', 'DEPARTMENT', 'COMPANY', 'PLATFORM'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_role_permissions_permission_id ON role_permissions (permission_id)`,
    );

    // Role nền tảng chỉ có scope PLATFORM; role công ty không được có scope PLATFORM
    // hay quyền nền tảng (không leo thang ra ngoài tenant).
    await queryRunner.query(`
      CREATE FUNCTION check_role_permissions_scope() RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
          role_tenant uuid;
          permission_is_platform boolean;
        BEGIN
          SELECT tenant_id INTO role_tenant FROM roles WHERE id = NEW.role_id;
          SELECT is_platform INTO permission_is_platform FROM permissions WHERE id = NEW.permission_id;
          IF role_tenant IS NULL AND NEW.scope <> 'PLATFORM' THEN
            RAISE EXCEPTION 'role_permissions_scope_invalid: role nền tảng chỉ dùng scope PLATFORM'
              USING ERRCODE = 'check_violation';
          END IF;
          IF role_tenant IS NOT NULL AND (NEW.scope = 'PLATFORM' OR permission_is_platform) THEN
            RAISE EXCEPTION 'role_permissions_scope_invalid: role công ty không được có quyền hoặc scope nền tảng'
              USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END;
        $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_role_permissions_check_scope
        BEFORE INSERT OR UPDATE ON role_permissions
        FOR EACH ROW EXECUTE FUNCTION check_role_permissions_scope()
    `);

    for (const [code, description, isPlatform] of PERMISSIONS) {
      await queryRunner.query(
        `INSERT INTO permissions (code, module, description, is_platform)
         VALUES ($1::text, split_part($1::text, '.', 1), $2, $3)`,
        [code, description, isPlatform],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE role_permissions`);
    await queryRunner.query(`DROP FUNCTION check_role_permissions_scope()`);
    await queryRunner.query(`DROP TABLE permissions`);
  }
}
