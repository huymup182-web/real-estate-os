import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-042: bảng password_reset_tokens, mỗi dòng là một mã OTP 6 số gửi qua email để đặt lại mật khẩu.
 * Thiết kế: docs/database.md mục 4.10.
 * - Chỉ lưu hash của mã (code_hash). Mã chỉ có 6 số nên hai user có thể trùng mã:
 *   không đặt UNIQUE trên hash như thiết kế ban đầu (token dài), mà tìm theo user_id.
 * - attempts đếm số lần nhập sai (TASK-043 huỷ mã khi sai quá số lần cho phép).
 * - used_at: mã đã dùng hoặc đã bị huỷ (không dùng lại được).
 * - Không có tenant_id: mã gắn với user, user thuộc công ty nào đã có ở users.
 * - Xoá cứng user thì xoá các mã của user.
 */
export class CreatePasswordResetTokens1791119364320 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE password_reset_tokens (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        code_hash varchar(64) NOT NULL,
        attempts smallint NOT NULL DEFAULT 0,
        expires_at timestamptz NOT NULL,
        used_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_password_reset_tokens PRIMARY KEY (id),
        CONSTRAINT fk_password_reset_tokens_user_id FOREIGN KEY (user_id)
          REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT ck_password_reset_tokens_code_hash_not_blank CHECK (btrim(code_hash) <> ''),
        CONSTRAINT ck_password_reset_tokens_attempts CHECK (attempts >= 0),
        CONSTRAINT ck_password_reset_tokens_expires_after_created CHECK (expires_at > created_at)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_password_reset_tokens_user_id_created_at
         ON password_reset_tokens (user_id, created_at DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE password_reset_tokens`);
  }
}
