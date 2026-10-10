import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Extension cho tìm kiếm BĐS (TASK-014):
 * - postgis: cột geography cho bản đồ và tìm theo bán kính.
 * - unaccent + immutable_unaccent(): bỏ dấu tiếng Việt. unaccent() không IMMUTABLE nên không dùng
 *   được trong cột generated; hàm bọc gọi unaccent với từ điển cố định nên an toàn khi đánh dấu IMMUTABLE.
 */
export class EnablePostgisUnaccent1791096043111 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS unaccent`);
    await queryRunner.query(`
      CREATE FUNCTION immutable_unaccent(text) RETURNS text
        LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
        AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION immutable_unaccent(text)`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS unaccent`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS postgis`);
  }
}
