import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-017: bảng owners (chủ nhà) và cột properties.owner_id. Thiết kế: docs/database.md mục 4.4.
 * - SĐT chủ nhà là dữ liệu nhạy cảm; quyền xem (property.view_owner_contact) kiểm ở backend.
 * - SĐT dạng chuẩn `+` và 8–15 chữ số, email dạng `x@y.z`, giống bảng users.
 * - properties.owner_id dùng khoá ngoại kép (tenant_id, owner_id): chỉ gắn chủ nhà cùng công ty.
 */
export class CreateOwners1791097085181 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE owners (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        full_name varchar(255) NOT NULL,
        phone varchar(20) NOT NULL,
        email citext NULL,
        notes text NULL,
        created_by uuid NULL,
        updated_by uuid NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz NULL,
        CONSTRAINT pk_owners PRIMARY KEY (id),
        CONSTRAINT uq_owners_tenant_id_id UNIQUE (tenant_id, id),
        CONSTRAINT fk_owners_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT fk_owners_created_by FOREIGN KEY (tenant_id, created_by)
          REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_owners_updated_by FOREIGN KEY (tenant_id, updated_by)
          REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_owners_full_name_not_blank CHECK (btrim(full_name) <> ''),
        CONSTRAINT ck_owners_phone_format CHECK (phone ~ '^\\+[0-9]{8,15}$'),
        CONSTRAINT ck_owners_email_format
          CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$')
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_owners_tenant_id_phone ON owners (tenant_id, phone)`);
    await queryRunner.query(`
      CREATE TRIGGER trg_owners_updated_at
        BEFORE UPDATE ON owners
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);

    await queryRunner.query(`ALTER TABLE properties ADD COLUMN owner_id uuid NULL`);
    await queryRunner.query(`
      ALTER TABLE properties
        ADD CONSTRAINT fk_properties_owner_id FOREIGN KEY (tenant_id, owner_id)
          REFERENCES owners (tenant_id, id) ON DELETE RESTRICT
    `);
    await queryRunner.query(`CREATE INDEX idx_properties_owner_id ON properties (owner_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE properties DROP COLUMN owner_id`);
    await queryRunner.query(`DROP TABLE owners`);
  }
}
