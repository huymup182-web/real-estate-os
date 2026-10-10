import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-156 (kiểm thử tải, docs/load-testing.md): index `properties (tenant_id, created_at DESC, id DESC)` kèm
 * các cột quyền xem (`status`, `agent_id`, `created_by`) cho danh sách BĐS `GET /properties`:
 * - Trang mặc định (mới nhất trước) đọc thẳng 20 dòng theo index thay vì đọc và sắp xếp mọi BĐS của công ty
 *   (~0,25 giây với 100.000 BĐS). Index `(tenant_id, status, created_at)` có sẵn không dùng được vì danh sách
 *   không lọc theo một trạng thái.
 * - Đếm tổng số BĐS xem được chạy index-only scan, không đọc bảng (nhanh khoảng 3 lần).
 * Thiếu index này, 50 người dùng cùng lúc làm database hết CPU.
 */
export class AddPropertiesNewestIndex1791133000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX idx_properties_tenant_id_created_at_id
         ON properties (tenant_id, created_at DESC, id DESC) INCLUDE (status, agent_id, created_by)
         WHERE deleted_at IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX idx_properties_tenant_id_created_at_id`);
  }
}
