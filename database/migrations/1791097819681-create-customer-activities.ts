import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-019: bảng customer_activities (timeline chăm sóc khách). Thiết kế: docs/database.md mục 4.5.
 * - Chỉ thêm, không sửa: trigger chặn mọi UPDATE để lịch sử không bị chỉnh lại.
 * - Khách và người thực hiện dùng khoá ngoại kép (tenant_id, id). Khách/user còn lịch sử thì
 *   không xoá cứng được (dùng soft delete), để giữ nguyên lịch sử.
 */
export class CreateCustomerActivities1791097819681 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE customer_activities (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        customer_id uuid NOT NULL,
        user_id uuid NOT NULL,
        type varchar(20) NOT NULL,
        content text NULL,
        property_ids uuid[] NULL,
        metadata jsonb NOT NULL DEFAULT '{}',
        occurred_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_customer_activities PRIMARY KEY (id),
        CONSTRAINT fk_customer_activities_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT fk_customer_activities_customer_id FOREIGN KEY (tenant_id, customer_id)
          REFERENCES customers (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_customer_activities_user_id FOREIGN KEY (tenant_id, user_id)
          REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_customer_activities_type CHECK (type IN (
          'CALL', 'MESSAGE', 'PROPERTY_SENT', 'VIEWING', 'NEGOTIATION', 'DEPOSIT',
          'NOTE', 'STATUS_CHANGE', 'ASSIGNMENT'
        )),
        CONSTRAINT ck_customer_activities_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_customer_activities_customer_id_occurred_at
        ON customer_activities (customer_id, occurred_at DESC)
    `);
    await queryRunner.query(
      `CREATE INDEX idx_customer_activities_user_id ON customer_activities (user_id)`,
    );

    await queryRunner.query(`
      CREATE FUNCTION prevent_customer_activities_update() RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RAISE EXCEPTION 'customer_activities_append_only: lịch sử chăm sóc khách không được sửa'
            USING ERRCODE = 'restrict_violation';
        END;
        $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_customer_activities_append_only
        BEFORE UPDATE ON customer_activities
        FOR EACH ROW EXECUTE FUNCTION prevent_customer_activities_update()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE customer_activities`);
    await queryRunner.query(`DROP FUNCTION prevent_customer_activities_update()`);
  }
}
