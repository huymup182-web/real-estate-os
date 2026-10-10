import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, revertAll } from './helpers.ts';

const TENANT = '00000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-000000000002';

const EXPECTED: readonly (readonly [string, string])[] = [
  ['properties', 'idx_properties_tenant_id_status_created_at'],
  ['properties', 'idx_properties_tenant_id_price'],
  ['properties', 'idx_properties_tenant_id_area'],
  ['properties', 'idx_properties_tenant_id_province_id_ward_id'],
  ['properties', 'idx_properties_tenant_id_agent_id'],
  ['properties', 'idx_properties_location'],
  ['properties', 'idx_properties_search_vector'],
  ['properties', 'idx_properties_search_vector_public'],
  ['properties', 'idx_properties_tenant_id_last_verified_at'],
  ['customers', 'idx_customers_tenant_id_agent_id_status'],
  ['customers', 'idx_customers_tenant_id_phone'],
  ['customer_activities', 'idx_customer_activities_customer_id_occurred_at'],
  ['appointments', 'idx_appointments_tenant_id_agent_id_scheduled_at'],
  ['appointments', 'idx_appointments_tenant_id_customer_id'],
  ['appointments', 'idx_appointments_tenant_id_property_id_scheduled_at'],
  ['deals', 'idx_deals_tenant_id_agent_id_stage'],
  ['deals', 'idx_deals_tenant_id_customer_id'],
  ['notifications', 'idx_notifications_user_id_read_at_created_at'],
  ['audit_logs', 'idx_audit_logs_tenant_id_created_at'],
  ['audit_logs', 'idx_audit_logs_tenant_id_entity_type_entity_id'],
  ['owners', 'idx_owners_tenant_id_phone'],
];

describe('TASK-026: index truy vấn', () => {
  let db: DataSource;

  before(async () => {
    db = await createCleanTestDataSource();
    await db.runMigrations();
  });

  after(async () => {
    await db.destroy();
  });

  async function indexNames(): Promise<Set<string>> {
    const rows: { tablename: string; indexname: string }[] = await db.query(
      `SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'public'`,
    );
    return new Set(rows.map((r) => `${r.tablename}.${r.indexname}`));
  }

  /** Kế hoạch truy vấn khi tắt seq scan: index dùng được thì planner phải chọn nó. */
  async function plan(sql: string, params: unknown[]): Promise<string> {
    return db.transaction(async (manager) => {
      await manager.query('SET LOCAL enable_seqscan = off');
      const rows: { 'QUERY PLAN': string }[] = await manager.query(`EXPLAIN ${sql}`, params);
      return rows.map((r) => r['QUERY PLAN']).join('\n');
    });
  }

  it('có đủ index theo kế hoạch docs/database.md mục 6', async () => {
    const names = await indexNames();
    for (const [table, index] of EXPECTED) {
      assert.ok(names.has(`${table}.${index}`), `${table}.${index}`);
    }
    assert.ok(!names.has('notifications.idx_notifications_user_id'));
  });

  it('danh sách BĐS mới nhất theo trạng thái dùng index partial', async () => {
    const result = await plan(
      `SELECT id FROM properties
        WHERE tenant_id = $1 AND status = 'AVAILABLE' AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 20`,
      [TENANT],
    );
    assert.match(result, /idx_properties_tenant_id_status_created_at/);
  });

  it('lọc + sắp xếp theo giá, full text search và bán kính bản đồ dùng index', async () => {
    assert.match(
      await plan(
        `SELECT id FROM properties WHERE tenant_id = $1 AND price <= $2 ORDER BY price LIMIT 20`,
        [TENANT, 5_000_000_000],
      ),
      /idx_properties_tenant_id_price/,
    );
    assert.match(
      await plan(
        `SELECT id FROM properties
          WHERE search_vector @@ plainto_tsquery('simple'::regconfig, immutable_unaccent($1))`,
        ['vinh hai'],
      ),
      /idx_properties_search_vector/,
    );
    assert.match(
      await plan(
        `SELECT id FROM properties
          WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 2000)`,
        [109.19, 12.27],
      ),
      /idx_properties_location/,
    );
  });

  it('TASK-154: tìm theo tiêu đề + mô tả và đếm lịch hẹn theo BĐS dùng index', async () => {
    assert.match(
      await plan(
        `SELECT id FROM properties
          WHERE search_vector_public @@ plainto_tsquery('simple'::regconfig, immutable_unaccent($1))`,
        ['vinh hai'],
      ),
      /idx_properties_search_vector_public/,
    );
    assert.match(
      await plan(
        `SELECT id FROM appointments WHERE tenant_id = $1 AND property_id = $2
          ORDER BY scheduled_at DESC LIMIT 20`,
        [TENANT, USER],
      ),
      /idx_appointments_tenant_id_property_id_scheduled_at/,
    );
  });

  it('hộp thư thông báo và tra cứu audit dùng index', async () => {
    assert.match(
      await plan(
        `SELECT id FROM notifications WHERE user_id = $1 AND read_at IS NULL
          ORDER BY created_at DESC LIMIT 20`,
        [USER],
      ),
      /idx_notifications_user_id_read_at_created_at/,
    );
    assert.match(
      await plan(
        `SELECT id FROM audit_logs WHERE tenant_id = $1 AND entity_type = 'property' AND entity_id = $2`,
        [TENANT, USER],
      ),
      /idx_audit_logs_tenant_id_entity_type_entity_id/,
    );
  });

  it('revert rồi chạy lại toàn bộ migration sạch', async () => {
    await revertAll(db);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
    assert.ok((await indexNames()).has('properties.idx_properties_location'));
  });
});
