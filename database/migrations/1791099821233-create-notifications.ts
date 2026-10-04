import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-024: bảng notifications (hộp thư trong app; push FCM chỉ là kênh gửi). Thiết kế: docs/database.md mục 4.8.
 * - tenant_id NULL cho thông báo hệ thống gửi tới user nền tảng (SUPER_ADMIN).
 * - Trigger đảm bảo tenant_id của thông báo trùng tenant_id của người nhận (kể cả trường hợp NULL),
 *   nên không gửi được thông báo sang công ty khác.
 * - data là object JSON (vd {"propertyId": "..."}). Xoá cứng user thì xoá hộp thư của user.
 * - Index hộp thư (user_id, read_at, created_at DESC) làm ở TASK-026.
 */
export class CreateNotifications1791099821233 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE notifications (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        tenant_id uuid NULL,
        user_id uuid NOT NULL,
        type varchar(30) NOT NULL,
        title varchar(255) NOT NULL,
        body text NOT NULL,
        data jsonb NOT NULL DEFAULT '{}',
        read_at timestamptz NULL,
        push_sent_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_notifications PRIMARY KEY (id),
        CONSTRAINT fk_notifications_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT fk_notifications_user_id FOREIGN KEY (user_id)
          REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT ck_notifications_type CHECK (type IN (
          'NEW_PROPERTY', 'PROPERTY_UPDATED', 'MATCHED_PROPERTY', 'CUSTOMER_ASSIGNED',
          'NEW_LEAD', 'VIEWING_REMINDER', 'VERIFY_REQUIRED', 'SYSTEM_NOTIFICATION'
        )),
        CONSTRAINT ck_notifications_title_not_blank CHECK (btrim(title) <> ''),
        CONSTRAINT ck_notifications_body_not_blank CHECK (btrim(body) <> ''),
        CONSTRAINT ck_notifications_data_object CHECK (jsonb_typeof(data) = 'object')
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_notifications_user_id ON notifications (user_id)`);

    await queryRunner.query(`
      CREATE FUNCTION check_notifications_tenant() RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
          user_tenant uuid;
        BEGIN
          SELECT tenant_id INTO user_tenant FROM users WHERE id = NEW.user_id;
          IF user_tenant IS DISTINCT FROM NEW.tenant_id THEN
            RAISE EXCEPTION 'notifications_tenant_mismatch: tenant_id phải trùng công ty của người nhận'
              USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END;
        $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_notifications_check_tenant
        BEFORE INSERT OR UPDATE OF tenant_id, user_id ON notifications
        FOR EACH ROW EXECUTE FUNCTION check_notifications_tenant()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE notifications`);
    await queryRunner.query(`DROP FUNCTION check_notifications_tenant()`);
  }
}
