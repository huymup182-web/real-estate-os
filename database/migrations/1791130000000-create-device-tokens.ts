import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-094: bảng device_tokens, mỗi dòng là token FCM của một thiết bị đã đăng nhập.
 * Thiết kế: docs/database.md mục 4.10.
 * - fcm_token duy nhất toàn hệ thống: một thiết bị chỉ thuộc người đăng nhập gần nhất trên nó.
 * - Trigger đảm bảo tenant_id trùng công ty của user (kể cả NULL cho user nền tảng).
 * - Xoá cứng user thì xoá token thiết bị của user.
 */
export class CreateDeviceTokens1791130000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE device_tokens (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        tenant_id uuid NULL,
        fcm_token text NOT NULL,
        platform varchar(10) NOT NULL,
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_device_tokens PRIMARY KEY (id),
        CONSTRAINT uq_device_tokens_fcm_token UNIQUE (fcm_token),
        CONSTRAINT fk_device_tokens_user_id FOREIGN KEY (user_id)
          REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_device_tokens_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT ck_device_tokens_fcm_token CHECK (
          btrim(fcm_token) <> '' AND char_length(fcm_token) <= 4096
        ),
        CONSTRAINT ck_device_tokens_platform CHECK (platform IN ('ANDROID', 'IOS', 'WEB'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_device_tokens_user_id ON device_tokens (user_id, last_seen_at DESC)`,
    );

    await queryRunner.query(`
      CREATE FUNCTION check_device_tokens_tenant() RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
          user_tenant uuid;
        BEGIN
          SELECT tenant_id INTO user_tenant FROM users WHERE id = NEW.user_id;
          IF user_tenant IS DISTINCT FROM NEW.tenant_id THEN
            RAISE EXCEPTION 'device_tokens_tenant_mismatch: tenant_id phải trùng công ty của user'
              USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END;
        $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_device_tokens_check_tenant
        BEFORE INSERT OR UPDATE OF tenant_id, user_id ON device_tokens
        FOR EACH ROW EXECUTE FUNCTION check_device_tokens_tenant()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE device_tokens`);
    await queryRunner.query(`DROP FUNCTION check_device_tokens_tenant()`);
  }
}
