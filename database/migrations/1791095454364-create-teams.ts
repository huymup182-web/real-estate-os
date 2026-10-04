import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TASK-012: bảng teams và team_members. Thiết kế: docs/database.md mục 4.1.
 * - Team thuộc một phòng ban; phòng ban, trưởng nhóm và thành viên dùng khoá ngoại kép (tenant_id, id),
 *   nên không gắn được dữ liệu của công ty khác.
 * - Một user có thể thuộc nhiều team.
 */
export class CreateTeams1791095454364 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE teams (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        department_id uuid NOT NULL,
        name varchar(255) NOT NULL,
        leader_id uuid NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz NULL,
        CONSTRAINT pk_teams PRIMARY KEY (id),
        CONSTRAINT uq_teams_tenant_id_id UNIQUE (tenant_id, id),
        CONSTRAINT fk_teams_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT fk_teams_department_id FOREIGN KEY (tenant_id, department_id)
          REFERENCES departments (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_teams_leader_id FOREIGN KEY (tenant_id, leader_id)
          REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_teams_name_not_blank CHECK (btrim(name) <> '')
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_teams_tenant_id_department_id_name
        ON teams (tenant_id, department_id, name) WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`CREATE INDEX idx_teams_department_id ON teams (department_id)`);
    await queryRunner.query(`CREATE INDEX idx_teams_leader_id ON teams (leader_id)`);
    await queryRunner.query(`
      CREATE TRIGGER trg_teams_updated_at
        BEFORE UPDATE ON teams
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);

    await queryRunner.query(`
      CREATE TABLE team_members (
        tenant_id uuid NOT NULL,
        team_id uuid NOT NULL,
        user_id uuid NOT NULL,
        joined_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_team_members PRIMARY KEY (team_id, user_id),
        CONSTRAINT fk_team_members_tenant_id FOREIGN KEY (tenant_id)
          REFERENCES companies (id) ON DELETE RESTRICT,
        CONSTRAINT fk_team_members_team_id FOREIGN KEY (tenant_id, team_id)
          REFERENCES teams (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_team_members_user_id FOREIGN KEY (tenant_id, user_id)
          REFERENCES users (tenant_id, id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_team_members_user_id ON team_members (user_id)`);
    await queryRunner.query(`CREATE INDEX idx_team_members_tenant_id ON team_members (tenant_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE team_members`);
    await queryRunner.query(`DROP TABLE teams`);
  }
}
