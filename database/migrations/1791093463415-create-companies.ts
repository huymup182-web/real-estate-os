import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-007: bảng companies (= tenant). Thiết kế: docs/database.md mục 4.1.
 */
export class CreateCompanies1791093463415 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE companies (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        name varchar(255) NOT NULL,
        slug varchar(100) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'ACTIVE',
        settings jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz NULL,
        CONSTRAINT pk_companies PRIMARY KEY (id),
        CONSTRAINT ck_companies_name_not_blank CHECK (btrim(name) <> ''),
        CONSTRAINT ck_companies_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
        CONSTRAINT ck_companies_status CHECK (status IN ('ACTIVE', 'SUSPENDED')),
        CONSTRAINT ck_companies_settings_object CHECK (jsonb_typeof(settings) = 'object')
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_companies_slug ON companies (slug) WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_companies_updated_at
        BEFORE UPDATE ON companies
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE companies`);
  }
}
