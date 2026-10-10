import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-056: quyền `property.assign` (đổi môi giới phụ trách BĐS), thêm bằng migration như mọi quyền mới
 * (phase0/04-RBAC.md mục 3). Ma trận mặc định giống `customer.assign`: COMPANY_ADMIN, DIRECTOR = COMPANY;
 * MANAGER = DEPARTMENT; TEAM_LEADER = TEAM; AGENT, COLLABORATOR không có.
 * Gán luôn cho các role mặc định (is_system) của công ty đã có; role tự tạo không đổi.
 */
const DEFAULT_SCOPES: readonly (readonly [role: string, scope: string])[] = [
  ['COMPANY_ADMIN', 'COMPANY'],
  ['DIRECTOR', 'COMPANY'],
  ['MANAGER', 'DEPARTMENT'],
  ['TEAM_LEADER', 'TEAM'],
];

export class AddPropertyAssignPermission1791128000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO permissions (code, module, description)
       VALUES ('property.assign', 'property', 'Đổi môi giới phụ trách bất động sản')`,
    );
    for (const [role, scope] of DEFAULT_SCOPES) {
      await queryRunner.query(
        `INSERT INTO role_permissions (role_id, permission_id, scope)
         SELECT r.id, p.id, $2
           FROM roles r CROSS JOIN permissions p
          WHERE p.code = 'property.assign'
            AND r.tenant_id IS NOT NULL AND r.is_system AND r.code = $1`,
        [role, scope],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM role_permissions
        WHERE permission_id IN (SELECT id FROM permissions WHERE code = 'property.assign')`,
    );
    await queryRunner.query(`DELETE FROM permissions WHERE code = 'property.assign'`);
  }
}
