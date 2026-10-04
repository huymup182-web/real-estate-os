import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-049: bộ đếm mã BĐS theo công ty, để sinh `properties.code` dạng `BDS-000001` khi tạo BĐS.
 * Thiết kế: docs/database.md mục 4.4.
 * - Mỗi công ty một dòng; backend tăng `last_value` bằng một câu UPSERT ... RETURNING trong cùng
 *   transaction với lệnh tạo BĐS, nên hai request tạo cùng lúc không bao giờ lấy trùng số.
 * - Số đã cấp không dùng lại (kể cả khi BĐS bị xoá hoặc transaction bị huỷ sau khi tăng).
 * - Xoá cứng công ty bị chặn như mọi bảng nghiệp vụ (ON DELETE RESTRICT).
 */
export class CreatePropertyCodeCounters1791127000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE property_code_counters (
        tenant_id uuid NOT NULL,
        last_value bigint NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_property_code_counters PRIMARY KEY (tenant_id),
        CONSTRAINT fk_property_code_counters_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT ck_property_code_counters_last_value CHECK (last_value > 0)
      )
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_property_code_counters_updated_at
        BEFORE UPDATE ON property_code_counters
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE property_code_counters`);
  }
}
