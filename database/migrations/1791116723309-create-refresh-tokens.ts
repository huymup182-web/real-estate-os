import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-040: bảng refresh_tokens, mỗi dòng là một refresh token của một phiên đăng nhập.
 * Thiết kế: docs/database.md mục 4.10.
 * - Chỉ lưu hash (token_hash) của token, không lưu token gốc.
 * - family_id gom các token sinh ra do xoay vòng từ cùng một lần đăng nhập; replaced_by trỏ tới
 *   token thay thế. Token đã bị thay thế mà còn được dùng lại thì backend thu hồi cả family.
 * - Trigger đảm bảo tenant_id trùng công ty của user (kể cả NULL cho user nền tảng).
 * - Xoá cứng user thì xoá các phiên của user.
 */
export class CreateRefreshTokens1791116723309 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE refresh_tokens (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        tenant_id uuid NULL,
        token_hash varchar(255) NOT NULL,
        family_id uuid NOT NULL,
        device_info text NULL,
        ip_address inet NULL,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz NULL,
        replaced_by uuid NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_refresh_tokens PRIMARY KEY (id),
        CONSTRAINT uq_refresh_tokens_token_hash UNIQUE (token_hash),
        CONSTRAINT fk_refresh_tokens_user_id FOREIGN KEY (user_id)
          REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_refresh_tokens_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT fk_refresh_tokens_replaced_by FOREIGN KEY (replaced_by)
          REFERENCES refresh_tokens (id) ON DELETE SET NULL,
        CONSTRAINT ck_refresh_tokens_token_hash_not_blank CHECK (btrim(token_hash) <> ''),
        CONSTRAINT ck_refresh_tokens_expires_after_created CHECK (expires_at > created_at)
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens (user_id)`);
    await queryRunner.query(
      `CREATE INDEX idx_refresh_tokens_family_id ON refresh_tokens (family_id)`,
    );

    await queryRunner.query(`
      CREATE FUNCTION check_refresh_tokens_tenant() RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
          user_tenant uuid;
        BEGIN
          SELECT tenant_id INTO user_tenant FROM users WHERE id = NEW.user_id;
          IF user_tenant IS DISTINCT FROM NEW.tenant_id THEN
            RAISE EXCEPTION 'refresh_tokens_tenant_mismatch: tenant_id phải trùng công ty của user'
              USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END;
        $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_refresh_tokens_check_tenant
        BEFORE INSERT OR UPDATE OF tenant_id, user_id ON refresh_tokens
        FOR EACH ROW EXECUTE FUNCTION check_refresh_tokens_tenant()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE refresh_tokens`);
    await queryRunner.query(`DROP FUNCTION check_refresh_tokens_tenant()`);
  }
}
