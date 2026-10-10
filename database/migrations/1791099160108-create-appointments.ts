import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-022: bảng appointments (lịch dẫn khách xem BĐS). Thiết kế: docs/database.md mục 4.7.
 * - Khách, BĐS, môi giới, người tạo/sửa dùng khoá ngoại kép (tenant_id, id): không hẹn chéo công ty.
 * - Khách/BĐS/môi giới còn lịch hẹn thì không xoá cứng được (dùng soft delete), để giữ lịch sử.
 * - Index cho lịch và lịch sử khách làm ở TASK-026.
 */
export class CreateAppointments1791099160108 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE appointments (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        customer_id uuid NOT NULL,
        property_id uuid NOT NULL,
        agent_id uuid NOT NULL,
        scheduled_at timestamptz NOT NULL,
        duration_minutes smallint NULL,
        location varchar(255) NULL,
        notes text NULL,
        status varchar(20) NOT NULL DEFAULT 'SCHEDULED',
        outcome varchar(20) NULL,
        reminder_sent_at timestamptz NULL,
        created_by uuid NULL,
        updated_by uuid NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz NULL,
        CONSTRAINT pk_appointments PRIMARY KEY (id),
        CONSTRAINT uq_appointments_tenant_id_id UNIQUE (tenant_id, id),
        CONSTRAINT fk_appointments_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT fk_appointments_customer_id FOREIGN KEY (tenant_id, customer_id)
          REFERENCES customers (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_appointments_property_id FOREIGN KEY (tenant_id, property_id)
          REFERENCES properties (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_appointments_agent_id FOREIGN KEY (tenant_id, agent_id)
          REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_appointments_created_by FOREIGN KEY (tenant_id, created_by)
          REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_appointments_updated_by FOREIGN KEY (tenant_id, updated_by)
          REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_appointments_duration_minutes CHECK (duration_minutes > 0),
        CONSTRAINT ck_appointments_status
          CHECK (status IN ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
        CONSTRAINT ck_appointments_outcome CHECK (outcome IN (
          'INTERESTED', 'NOT_INTERESTED', 'NEED_FOLLOW_UP', 'NEGOTIATING'
        ))
      )
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_appointments_updated_at
        BEFORE UPDATE ON appointments
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE appointments`);
  }
}
