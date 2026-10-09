import { Column, Entity, type ValueTransformer } from 'typeorm';

import { TenantEntity } from '../database/tenant-entity.js';

/** PostgreSQL trả bigint dạng chuỗi; đổi sang number (số tiền giữ dưới MAX_SAFE_INTEGER). */
const toNumber: ValueTransformer = {
  to: (value: unknown) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

/** Bảng deals (TASK-023): giao dịch giữa khách và BĐS. Truy vấn luôn qua TenantRepository. */
@Entity({ name: 'deals' })
export class Deal extends TenantEntity {
  @Column({ type: 'uuid' })
  customerId!: string;

  @Column({ type: 'uuid' })
  propertyId!: string;

  @Column({ type: 'uuid' })
  agentId!: string;

  @Column({ type: 'varchar', default: 'NEGOTIATING' })
  stage!: string;

  @Column({ type: 'bigint', nullable: true, transformer: toNumber })
  dealPrice!: number | null;

  @Column({ type: 'bigint', nullable: true, transformer: toNumber })
  depositAmount!: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  depositAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedBy!: string | null;
}
