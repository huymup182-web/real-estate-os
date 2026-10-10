import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-013: bảng provinces, districts, wards. Thiết kế: docs/database.md mục 4.3.
 * - Dữ liệu dùng chung cho mọi công ty: không có tenant_id, không soft delete.
 * - Từ 01/07/2025 bỏ cấp quận/huyện, nên wards.district_id có thể NULL;
 *   districts giữ lại cho địa chỉ cũ. is_active = false là đơn vị cũ đã sáp nhập.
 * - Khi có district_id, quận/huyện phải cùng tỉnh với phường/xã (khoá ngoại kép).
 */
export class CreateLocations1791095795199 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE provinces (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        code varchar(10) NOT NULL,
        name varchar(100) NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_provinces PRIMARY KEY (id),
        CONSTRAINT uq_provinces_code UNIQUE (code),
        CONSTRAINT ck_provinces_code_not_blank CHECK (btrim(code) <> ''),
        CONSTRAINT ck_provinces_name_not_blank CHECK (btrim(name) <> '')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE districts (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        province_id uuid NOT NULL,
        code varchar(10) NOT NULL,
        name varchar(100) NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_districts PRIMARY KEY (id),
        CONSTRAINT uq_districts_code UNIQUE (code),
        CONSTRAINT uq_districts_province_id_id UNIQUE (province_id, id),
        CONSTRAINT fk_districts_province_id FOREIGN KEY (province_id)
          REFERENCES provinces (id) ON DELETE RESTRICT,
        CONSTRAINT ck_districts_code_not_blank CHECK (btrim(code) <> ''),
        CONSTRAINT ck_districts_name_not_blank CHECK (btrim(name) <> '')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE wards (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        province_id uuid NOT NULL,
        district_id uuid NULL,
        code varchar(10) NOT NULL,
        name varchar(100) NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_wards PRIMARY KEY (id),
        CONSTRAINT uq_wards_code UNIQUE (code),
        CONSTRAINT fk_wards_province_id FOREIGN KEY (province_id)
          REFERENCES provinces (id) ON DELETE RESTRICT,
        CONSTRAINT fk_wards_district_id FOREIGN KEY (province_id, district_id)
          REFERENCES districts (province_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_wards_code_not_blank CHECK (btrim(code) <> ''),
        CONSTRAINT ck_wards_name_not_blank CHECK (btrim(name) <> '')
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_wards_province_id ON wards (province_id)`);
    await queryRunner.query(`CREATE INDEX idx_wards_district_id ON wards (district_id)`);

    for (const table of ['provinces', 'districts', 'wards']) {
      await queryRunner.query(`
        CREATE TRIGGER trg_${table}_updated_at
          BEFORE UPDATE ON ${table}
          FOR EACH ROW EXECUTE FUNCTION set_updated_at()
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE wards`);
    await queryRunner.query(`DROP TABLE districts`);
    await queryRunner.query(`DROP TABLE provinces`);
  }
}
