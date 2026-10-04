import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Extension citext: so sánh email không phân biệt hoa thường. */
export class EnableCitext1791094180612 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS citext`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP EXTENSION IF EXISTS citext`);
  }
}
