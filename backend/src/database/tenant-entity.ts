import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Lớp cơ sở cho entity của bảng nghiệp vụ (có tenant_id, created_at, updated_at, deleted_at).
 * - id và các mốc thời gian do database sinh (DEFAULT gen_random_uuid(), now(), trigger updated_at).
 * - deletedAt khác NULL = đã soft delete; TypeORM tự bỏ qua bản ghi này khi đọc.
 * Entity cụ thể được tạo cùng module nghiệp vụ ở các task sau.
 */
export abstract class TenantEntity {
  @PrimaryColumn({ type: 'uuid', insert: false, update: false, default: () => 'gen_random_uuid()' })
  id!: string;

  @Column({ type: 'uuid', update: false })
  tenantId!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
