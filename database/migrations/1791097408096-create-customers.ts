import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-018: bảng customers và customer_preferences. Thiết kế: docs/database.md mục 4.5.
 * - Danh sách nguồn khách (source) được Huy Lê duyệt ngày 2026-10-04.
 * - Người phụ trách, người tạo/sửa dùng khoá ngoại kép (tenant_id, id) tới users.
 * - customer_preferences là nhu cầu của khách (đầu vào matching); giá trị trong các mảng
 *   phải thuộc đúng danh sách của bảng properties.
 */
export class CreateCustomers1791097408096 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE customers (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        full_name varchar(255) NOT NULL,
        phone varchar(20) NOT NULL,
        email citext NULL,
        purpose varchar(20) NULL,
        purchase_timeline varchar(20) NULL,
        source varchar(30) NULL,
        agent_id uuid NULL,
        status varchar(20) NOT NULL DEFAULT 'NEW',
        lost_reason text NULL,
        notes text NULL,
        created_by uuid NULL,
        updated_by uuid NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz NULL,
        CONSTRAINT pk_customers PRIMARY KEY (id),
        CONSTRAINT uq_customers_tenant_id_id UNIQUE (tenant_id, id),
        CONSTRAINT fk_customers_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT fk_customers_agent_id FOREIGN KEY (tenant_id, agent_id)
          REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_customers_created_by FOREIGN KEY (tenant_id, created_by)
          REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_customers_updated_by FOREIGN KEY (tenant_id, updated_by)
          REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_customers_full_name_not_blank CHECK (btrim(full_name) <> ''),
        CONSTRAINT ck_customers_phone_format CHECK (phone ~ '^\\+[0-9]{8,15}$'),
        CONSTRAINT ck_customers_email_format
          CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'),
        CONSTRAINT ck_customers_purpose
          CHECK (purpose IN ('LIVING', 'INVESTMENT', 'RENT', 'OTHER')),
        CONSTRAINT ck_customers_purchase_timeline CHECK (purchase_timeline IN (
          'IMMEDIATE', 'WITHIN_3_MONTHS', 'WITHIN_6_MONTHS', 'OVER_6_MONTHS', 'UNKNOWN'
        )),
        CONSTRAINT ck_customers_source CHECK (source IN (
          'REFERRAL', 'WALK_IN', 'FACEBOOK', 'ZALO', 'TIKTOK', 'WEBSITE',
          'BROKER_PARTNER', 'OLD_CUSTOMER', 'OTHER'
        )),
        CONSTRAINT ck_customers_status CHECK (status IN (
          'NEW', 'CONTACTED', 'QUALIFIED', 'VIEWING', 'NEGOTIATING', 'DEPOSIT', 'WON', 'LOST'
        ))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_customers_tenant_id_phone ON customers (tenant_id, phone)`,
    );
    await queryRunner.query(`
      CREATE TRIGGER trg_customers_updated_at
        BEFORE UPDATE ON customers
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);

    await queryRunner.query(`
      CREATE TABLE customer_preferences (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        customer_id uuid NOT NULL,
        transaction_type varchar(10) NOT NULL DEFAULT 'SALE',
        property_types varchar(30)[] NULL,
        budget_min bigint NULL,
        budget_max bigint NULL,
        area_min numeric(12, 2) NULL,
        area_max numeric(12, 2) NULL,
        bedrooms_min smallint NULL,
        province_ids uuid[] NULL,
        district_ids uuid[] NULL,
        ward_ids uuid[] NULL,
        directions varchar(2)[] NULL,
        legal_statuses varchar(30)[] NULL,
        min_road_access varchar(10) NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz NULL,
        CONSTRAINT pk_customer_preferences PRIMARY KEY (id),
        CONSTRAINT fk_customer_preferences_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT fk_customer_preferences_customer_id FOREIGN KEY (tenant_id, customer_id)
          REFERENCES customers (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT ck_customer_preferences_transaction_type
          CHECK (transaction_type IN ('SALE', 'RENT')),
        CONSTRAINT ck_customer_preferences_property_types CHECK (property_types <@ ARRAY[
          'HOUSE', 'APARTMENT', 'VILLA', 'SHOPHOUSE', 'LAND', 'LAND_PLOT',
          'AGRICULTURAL_LAND', 'WAREHOUSE', 'OTHER'
        ]::varchar[]),
        CONSTRAINT ck_customer_preferences_budget CHECK (
          (budget_min IS NULL OR budget_min >= 0)
          AND (budget_max IS NULL OR budget_max >= 0)
          AND (budget_min IS NULL OR budget_max IS NULL OR budget_min <= budget_max)
        ),
        CONSTRAINT ck_customer_preferences_area CHECK (
          (area_min IS NULL OR area_min >= 0)
          AND (area_max IS NULL OR area_max >= 0)
          AND (area_min IS NULL OR area_max IS NULL OR area_min <= area_max)
        ),
        CONSTRAINT ck_customer_preferences_bedrooms_min CHECK (bedrooms_min >= 0),
        CONSTRAINT ck_customer_preferences_directions CHECK (directions <@ ARRAY[
          'N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'
        ]::varchar[]),
        CONSTRAINT ck_customer_preferences_legal_statuses CHECK (legal_statuses <@ ARRAY[
          'PRIVATE_BOOK', 'SHARED_BOOK', 'PENDING_BOOK', 'SALE_CONTRACT', 'HANDWRITTEN', 'OTHER'
        ]::varchar[]),
        CONSTRAINT ck_customer_preferences_min_road_access
          CHECK (min_road_access IN ('CAR', 'MOTORBIKE', 'WALK'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_customer_preferences_customer_id ON customer_preferences (customer_id)`,
    );
    await queryRunner.query(`
      CREATE TRIGGER trg_customer_preferences_updated_at
        BEFORE UPDATE ON customer_preferences
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE customer_preferences`);
    await queryRunner.query(`DROP TABLE customers`);
  }
}
