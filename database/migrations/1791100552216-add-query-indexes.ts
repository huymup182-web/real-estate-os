import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-026: index phục vụ truy vấn chính. Kế hoạch: docs/database.md mục 6.
 * - Index bảng nghiệp vụ bắt đầu bằng tenant_id vì mọi truy vấn đều lọc theo công ty.
 * - Index hộp thư notifications (user_id, read_at, created_at) thay index user_id cũ (là tiền tố của nó).
 * - Index đã có từ các task trước (customers/owners theo phone, timeline customer_activities) giữ nguyên.
 */
const INDEXES: readonly (readonly [string, string])[] = [
  [
    'idx_properties_tenant_id_status_created_at',
    'properties (tenant_id, status, created_at DESC) WHERE deleted_at IS NULL',
  ],
  ['idx_properties_tenant_id_price', 'properties (tenant_id, price)'],
  ['idx_properties_tenant_id_area', 'properties (tenant_id, area)'],
  ['idx_properties_tenant_id_province_id_ward_id', 'properties (tenant_id, province_id, ward_id)'],
  ['idx_properties_tenant_id_agent_id', 'properties (tenant_id, agent_id)'],
  ['idx_properties_location', 'properties USING gist (location)'],
  ['idx_properties_search_vector', 'properties USING gin (search_vector)'],
  ['idx_properties_tenant_id_last_verified_at', 'properties (tenant_id, last_verified_at)'],
  ['idx_customers_tenant_id_agent_id_status', 'customers (tenant_id, agent_id, status)'],
  [
    'idx_appointments_tenant_id_agent_id_scheduled_at',
    'appointments (tenant_id, agent_id, scheduled_at)',
  ],
  ['idx_appointments_tenant_id_customer_id', 'appointments (tenant_id, customer_id)'],
  ['idx_deals_tenant_id_agent_id_stage', 'deals (tenant_id, agent_id, stage)'],
  ['idx_deals_tenant_id_customer_id', 'deals (tenant_id, customer_id)'],
  [
    'idx_notifications_user_id_read_at_created_at',
    'notifications (user_id, read_at, created_at DESC)',
  ],
  ['idx_audit_logs_tenant_id_created_at', 'audit_logs (tenant_id, created_at DESC)'],
  [
    'idx_audit_logs_tenant_id_entity_type_entity_id',
    'audit_logs (tenant_id, entity_type, entity_id)',
  ],
];

export class AddQueryIndexes1791100552216 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [name, definition] of INDEXES) {
      await queryRunner.query(`CREATE INDEX ${name} ON ${definition}`);
    }
    await queryRunner.query(`DROP INDEX idx_notifications_user_id`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX idx_notifications_user_id ON notifications (user_id)`);
    for (const [name] of [...INDEXES].reverse()) {
      await queryRunner.query(`DROP INDEX ${name}`);
    }
  }
}
