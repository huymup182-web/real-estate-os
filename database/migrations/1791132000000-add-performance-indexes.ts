import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-154 (tối ưu hiệu năng, kết quả đo ở docs/performance.md):
 * - `properties.search_vector_public`: tsvector sinh tự động từ tiêu đề + mô tả (không có địa chỉ), có index GIN.
 *   Người không được xem liên hệ chủ nhà chỉ được tìm theo tiêu đề, mô tả (TASK-064); trước đây backend phải
 *   tính tsvector này cho từng dòng khớp `search_vector`, không dùng được index.
 * - `appointments (tenant_id, property_id, scheduled_at)`: đếm lượt dẫn khách theo BĐS (thanh khoản TASK-147),
 *   lọc lịch hẹn theo BĐS. Thiếu index này, thống kê thanh khoản của công ty 100.000 BĐS chạy hơn 3 phút.
 */
export class AddPerformanceIndexes1791132000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE properties ADD COLUMN search_vector_public tsvector GENERATED ALWAYS AS (
        to_tsvector('simple'::regconfig, immutable_unaccent(
          coalesce(title, '') || ' ' || coalesce(description, '')
        ))
      ) STORED
    `);
    await queryRunner.query(
      `CREATE INDEX idx_properties_search_vector_public ON properties USING gin (search_vector_public)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_appointments_tenant_id_property_id_scheduled_at
         ON appointments (tenant_id, property_id, scheduled_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX idx_appointments_tenant_id_property_id_scheduled_at`);
    await queryRunner.query(`DROP INDEX idx_properties_search_vector_public`);
    await queryRunner.query(`ALTER TABLE properties DROP COLUMN search_vector_public`);
  }
}
