// CLI migration: node src/cli.ts <run|revert|show|create|seed> [tên-migration]
import { writeFileSync } from 'node:fs';

import { createDataSource, requireDatabaseUrl } from './data-source.ts';
import { DEMO_PASSWORD_ENV, seedDemo } from './seed.ts';

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url);

function toPascalCase(kebab: string): string {
  return kebab
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function createMigrationFile(name: string | undefined): void {
  if (!name || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    throw new Error('Tên migration phải là kebab-case, vd: create-users');
  }
  const timestamp = Date.now();
  const className = `${toPascalCase(name)}${timestamp}`;
  const fileUrl = new URL(`${timestamp}-${name}.ts`, MIGRATIONS_DIR);
  const content = `import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ${className} implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(\`\`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(\`\`);
  }
}
`;
  writeFileSync(fileUrl, content, { flag: 'wx' });
  console.log(`Đã tạo ${fileUrl.pathname}`);
}

async function main(): Promise<void> {
  const [command, arg] = process.argv.slice(2);

  if (command === 'create') {
    createMigrationFile(arg);
    return;
  }

  const dataSource = createDataSource(requireDatabaseUrl());
  await dataSource.initialize();
  try {
    if (command === 'run') {
      const applied = await dataSource.runMigrations();
      console.log(
        applied.length === 0
          ? 'Không có migration mới.'
          : `Đã chạy ${applied.length} migration: ${applied.map((m) => m.name).join(', ')}`,
      );
    } else if (command === 'revert') {
      await dataSource.undoLastMigration();
      console.log('Đã hoàn tác migration gần nhất.');
    } else if (command === 'show') {
      const pending = await dataSource.showMigrations();
      console.log(pending ? 'Có migration chưa chạy.' : 'Mọi migration đã được chạy.');
    } else if (command === 'seed') {
      if (process.env['NODE_ENV'] === 'production') {
        throw new Error('Không nạp dữ liệu demo ở production');
      }
      const password = process.env[DEMO_PASSWORD_ENV];
      if (!password) {
        throw new Error(`Thiếu biến môi trường ${DEMO_PASSWORD_ENV} (mật khẩu tài khoản demo)`);
      }
      const result = await seedDemo(dataSource, password);
      console.log(result.created ? 'Đã nạp dữ liệu demo.' : 'Dữ liệu demo đã có, không nạp lại.');
    } else {
      throw new Error('Lệnh không hợp lệ. Dùng: run | revert | show | seed | create <tên>');
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
