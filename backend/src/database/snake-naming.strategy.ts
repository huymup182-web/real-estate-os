import { DefaultNamingStrategy } from 'typeorm';

/** camelCase → snake_case, vd `tenantId` → `tenant_id`, `createdAt` → `created_at`. */
export function toSnakeCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * Thuộc tính entity viết camelCase, cột database viết snake_case (docs/coding-standards.md).
 * Tên cột ghi rõ trong @Column({ name }) vẫn được giữ nguyên.
 */
export class SnakeNamingStrategy extends DefaultNamingStrategy {
  override columnName(
    propertyName: string,
    customName: string | undefined,
    prefixes: string[],
  ): string {
    return customName ?? toSnakeCase([...prefixes, propertyName].join('_'));
  }

  override relationName(propertyName: string): string {
    return toSnakeCase(propertyName);
  }

  override joinColumnName(relationName: string, referencedColumnName: string): string {
    return toSnakeCase(`${relationName}_${referencedColumnName}`);
  }
}
