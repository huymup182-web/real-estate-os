import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-133: bảng ai_requests, mỗi dòng là một lời gọi LLM qua AI gateway của backend.
 * Thiết kế: docs/database.md mục 4.11.
 * - Chỉ lưu thông tin để audit và giới hạn lượt dùng (ai gọi, tính năng nào, tool LLM đã gọi, số token),
 *   không lưu nội dung prompt/câu trả lời vì có thể chứa dữ liệu khách hàng.
 * - Trigger đảm bảo tenant_id trùng công ty của user (kể cả NULL cho user nền tảng).
 * - Giống audit_logs: user/công ty đã có lượt gọi AI thì không xoá cứng được (ON DELETE RESTRICT).
 */
export class CreateAiRequests1791131000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ai_requests (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        tenant_id uuid NULL,
        user_id uuid NOT NULL,
        feature varchar(50) NOT NULL,
        provider varchar(30) NOT NULL,
        model varchar(100) NOT NULL,
        status varchar(10) NOT NULL,
        input_tokens integer NULL,
        output_tokens integer NULL,
        tool_names text[] NOT NULL DEFAULT '{}',
        error_code varchar(50) NULL,
        latency_ms integer NOT NULL,
        request_id varchar(100) NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_ai_requests PRIMARY KEY (id),
        CONSTRAINT fk_ai_requests_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT fk_ai_requests_user_id FOREIGN KEY (user_id)
          REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT ck_ai_requests_feature CHECK (feature ~ '^[a-z][a-z_]*$'),
        CONSTRAINT ck_ai_requests_provider CHECK (btrim(provider) <> ''),
        CONSTRAINT ck_ai_requests_model CHECK (btrim(model) <> ''),
        CONSTRAINT ck_ai_requests_status CHECK (status IN ('SUCCESS', 'ERROR')),
        CONSTRAINT ck_ai_requests_error_code CHECK ((status = 'ERROR') = (error_code IS NOT NULL)),
        CONSTRAINT ck_ai_requests_tokens CHECK (
          (input_tokens IS NULL OR input_tokens >= 0) AND (output_tokens IS NULL OR output_tokens >= 0)
        ),
        CONSTRAINT ck_ai_requests_latency_ms CHECK (latency_ms >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_ai_requests_user_id ON ai_requests (user_id, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_ai_requests_tenant_id ON ai_requests (tenant_id, created_at DESC)`,
    );

    await queryRunner.query(`
      CREATE FUNCTION check_ai_requests_tenant() RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
          user_tenant uuid;
        BEGIN
          SELECT tenant_id INTO user_tenant FROM users WHERE id = NEW.user_id;
          IF user_tenant IS DISTINCT FROM NEW.tenant_id THEN
            RAISE EXCEPTION 'ai_requests_tenant_mismatch: tenant_id phải trùng công ty của user'
              USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END;
        $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_ai_requests_check_tenant
        BEFORE INSERT OR UPDATE OF tenant_id, user_id ON ai_requests
        FOR EACH ROW EXECUTE FUNCTION check_ai_requests_tenant()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE ai_requests`);
    await queryRunner.query(`DROP FUNCTION check_ai_requests_tenant()`);
  }
}
