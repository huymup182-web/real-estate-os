import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-023: bảng deals (giao dịch) và commissions (hoa hồng). Thiết kế: docs/database.md mục 4.7.
 * - Mọi tham chiếu dùng khoá ngoại kép (tenant_id, id): không giao dịch hay chia hoa hồng chéo công ty.
 * - Giao dịch và hoa hồng là dữ liệu tài chính: không xoá cứng bản ghi đang được tham chiếu
 *   (ON DELETE RESTRICT), dùng soft delete.
 * - Số tiền không âm, tỷ lệ hoa hồng trong khoảng 0–100. Index báo cáo làm ở TASK-026.
 */
export class CreateDealsCommissions1791099481730 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE deals (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        customer_id uuid NOT NULL,
        property_id uuid NOT NULL,
        agent_id uuid NOT NULL,
        stage varchar(20) NOT NULL DEFAULT 'NEGOTIATING',
        deal_price bigint NULL,
        deposit_amount bigint NULL,
        deposit_at timestamptz NULL,
        closed_at timestamptz NULL,
        notes text NULL,
        created_by uuid NULL,
        updated_by uuid NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz NULL,
        CONSTRAINT pk_deals PRIMARY KEY (id),
        CONSTRAINT uq_deals_tenant_id_id UNIQUE (tenant_id, id),
        CONSTRAINT fk_deals_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT fk_deals_customer_id FOREIGN KEY (tenant_id, customer_id)
          REFERENCES customers (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_deals_property_id FOREIGN KEY (tenant_id, property_id)
          REFERENCES properties (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_deals_agent_id FOREIGN KEY (tenant_id, agent_id)
          REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_deals_created_by FOREIGN KEY (tenant_id, created_by)
          REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_deals_updated_by FOREIGN KEY (tenant_id, updated_by)
          REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_deals_stage
          CHECK (stage IN ('NEGOTIATING', 'DEPOSIT', 'CONTRACT', 'WON', 'LOST')),
        CONSTRAINT ck_deals_deal_price CHECK (deal_price >= 0),
        CONSTRAINT ck_deals_deposit_amount CHECK (deposit_amount >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_deals_updated_at
        BEFORE UPDATE ON deals
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);

    await queryRunner.query(`
      CREATE TABLE commissions (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        deal_id uuid NOT NULL,
        user_id uuid NOT NULL,
        role_in_deal varchar(20) NOT NULL,
        amount bigint NOT NULL,
        percent numeric(5, 2) NULL,
        status varchar(20) NOT NULL DEFAULT 'PENDING',
        paid_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz NULL,
        CONSTRAINT pk_commissions PRIMARY KEY (id),
        CONSTRAINT fk_commissions_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT fk_commissions_deal_id FOREIGN KEY (tenant_id, deal_id)
          REFERENCES deals (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_commissions_user_id FOREIGN KEY (tenant_id, user_id)
          REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_commissions_role_in_deal CHECK (role_in_deal IN (
          'LISTING_AGENT', 'SELLING_AGENT', 'COLLABORATOR', 'LEADER'
        )),
        CONSTRAINT ck_commissions_amount CHECK (amount >= 0),
        CONSTRAINT ck_commissions_percent CHECK (percent >= 0 AND percent <= 100),
        CONSTRAINT ck_commissions_status
          CHECK (status IN ('PENDING', 'APPROVED', 'PAID', 'CANCELLED'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_commissions_tenant_id_deal_id ON commissions (tenant_id, deal_id)`,
    );
    await queryRunner.query(`
      CREATE TRIGGER trg_commissions_updated_at
        BEFORE UPDATE ON commissions
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE commissions`);
    await queryRunner.query(`DROP TABLE deals`);
  }
}
