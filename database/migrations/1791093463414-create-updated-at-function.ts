import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hàm trigger dùng chung: tự cập nhật cột updated_at mỗi khi bản ghi thay đổi,
 * kể cả khi dữ liệu được sửa ngoài ứng dụng.
 */
export class CreateUpdatedAtFunction1791093463414 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE FUNCTION set_updated_at() RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          NEW.updated_at = now();
          RETURN NEW;
        END;
        $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION set_updated_at()`);
  }
}
