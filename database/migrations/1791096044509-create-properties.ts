import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-014: bảng properties. Thiết kế: docs/database.md mục 4.4.
 * - Danh sách property_type, legal_status, source đã được Huy Lê duyệt ngày 2026-10-04.
 * - Môi giới, người xác minh, người tạo/sửa dùng khoá ngoại kép (tenant_id, id) tới users.
 * - Phường/xã và quận/huyện phải thuộc đúng tỉnh của BĐS.
 * - owner_id được thêm ở TASK-017 khi có bảng owners. Index tìm kiếm/lọc làm ở TASK-026.
 */
export class CreateProperties1791096044509 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Cho phép khoá ngoại kép (province_id, ward_id) từ properties
    await queryRunner.query(
      `ALTER TABLE wards ADD CONSTRAINT uq_wards_province_id_id UNIQUE (province_id, id)`,
    );

    await queryRunner.query(`
      CREATE TABLE properties (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        code varchar(20) NOT NULL,
        title varchar(255) NOT NULL,
        description text NULL,
        transaction_type varchar(10) NOT NULL DEFAULT 'SALE',
        property_type varchar(30) NOT NULL,
        price bigint NOT NULL,
        area numeric(12, 2) NOT NULL,
        price_per_m2 bigint GENERATED ALWAYS AS ((price / NULLIF(area, 0))::bigint) STORED,
        bedrooms smallint NULL,
        bathrooms smallint NULL,
        floors smallint NULL,
        direction varchar(2) NULL,
        road_width numeric(6, 2) NULL,
        road_access varchar(10) NULL,
        legal_status varchar(30) NULL,
        province_id uuid NOT NULL,
        district_id uuid NULL,
        ward_id uuid NOT NULL,
        street_address varchar(255) NULL,
        latitude numeric(9, 6) NULL,
        longitude numeric(9, 6) NULL,
        location geography(Point, 4326) GENERATED ALWAYS AS (
          CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL
            THEN ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision), 4326)::geography
          END
        ) STORED,
        status varchar(20) NOT NULL DEFAULT 'AVAILABLE',
        agent_id uuid NOT NULL,
        source varchar(30) NULL,
        commission_type varchar(10) NULL,
        commission_value numeric(14, 2) NULL,
        verification_status varchar(20) NOT NULL DEFAULT 'UNVERIFIED',
        last_verified_at timestamptz NULL,
        verified_by uuid NULL,
        search_vector tsvector GENERATED ALWAYS AS (
          to_tsvector('simple'::regconfig, immutable_unaccent(
            coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(street_address, '')
          ))
        ) STORED,
        created_by uuid NULL,
        updated_by uuid NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz NULL,
        CONSTRAINT pk_properties PRIMARY KEY (id),
        CONSTRAINT uq_properties_tenant_id_id UNIQUE (tenant_id, id),
        CONSTRAINT uq_properties_tenant_id_code UNIQUE (tenant_id, code),
        CONSTRAINT fk_properties_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT fk_properties_province_id FOREIGN KEY (province_id)
          REFERENCES provinces (id) ON DELETE RESTRICT,
        CONSTRAINT fk_properties_district_id FOREIGN KEY (province_id, district_id)
          REFERENCES districts (province_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_properties_ward_id FOREIGN KEY (province_id, ward_id)
          REFERENCES wards (province_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_properties_agent_id FOREIGN KEY (tenant_id, agent_id)
          REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_properties_verified_by FOREIGN KEY (tenant_id, verified_by)
          REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_properties_created_by FOREIGN KEY (tenant_id, created_by)
          REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_properties_updated_by FOREIGN KEY (tenant_id, updated_by)
          REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_properties_code_not_blank CHECK (btrim(code) <> ''),
        CONSTRAINT ck_properties_title_not_blank CHECK (btrim(title) <> ''),
        CONSTRAINT ck_properties_transaction_type CHECK (transaction_type IN ('SALE', 'RENT')),
        CONSTRAINT ck_properties_property_type CHECK (property_type IN (
          'HOUSE', 'APARTMENT', 'VILLA', 'SHOPHOUSE', 'LAND', 'LAND_PLOT',
          'AGRICULTURAL_LAND', 'WAREHOUSE', 'OTHER'
        )),
        CONSTRAINT ck_properties_price CHECK (price >= 0),
        CONSTRAINT ck_properties_area CHECK (area > 0),
        CONSTRAINT ck_properties_rooms CHECK (
          (bedrooms IS NULL OR bedrooms >= 0)
          AND (bathrooms IS NULL OR bathrooms >= 0)
          AND (floors IS NULL OR floors >= 0)
        ),
        CONSTRAINT ck_properties_direction
          CHECK (direction IN ('N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW')),
        CONSTRAINT ck_properties_road_width CHECK (road_width >= 0),
        CONSTRAINT ck_properties_road_access CHECK (road_access IN ('CAR', 'MOTORBIKE', 'WALK')),
        CONSTRAINT ck_properties_legal_status CHECK (legal_status IN (
          'PRIVATE_BOOK', 'SHARED_BOOK', 'PENDING_BOOK', 'SALE_CONTRACT', 'HANDWRITTEN', 'OTHER'
        )),
        CONSTRAINT ck_properties_coordinates CHECK (
          (latitude IS NULL AND longitude IS NULL)
          OR (latitude IS NOT NULL AND longitude IS NOT NULL
              AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
        ),
        CONSTRAINT ck_properties_status CHECK (status IN (
          'AVAILABLE', 'PENDING', 'SOLD', 'HIDDEN', 'EXPIRED', 'VERIFY_REQUIRED'
        )),
        CONSTRAINT ck_properties_source CHECK (source IN (
          'OWNER_DIRECT', 'SELF_SOURCED', 'BROKER_PARTNER', 'REFERRAL', 'ONLINE_LISTING', 'OTHER'
        )),
        CONSTRAINT ck_properties_commission_type CHECK (commission_type IN ('PERCENT', 'FIXED')),
        CONSTRAINT ck_properties_commission_pair
          CHECK ((commission_type IS NULL) = (commission_value IS NULL)),
        CONSTRAINT ck_properties_commission_value CHECK (
          commission_value >= 0 AND (commission_type <> 'PERCENT' OR commission_value <= 100)
        ),
        CONSTRAINT ck_properties_verification_status
          CHECK (verification_status IN ('UNVERIFIED', 'VERIFIED', 'EXPIRED'))
      )
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_properties_updated_at
        BEFORE UPDATE ON properties
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE properties`);
    await queryRunner.query(`ALTER TABLE wards DROP CONSTRAINT uq_wards_province_id_id`);
  }
}
