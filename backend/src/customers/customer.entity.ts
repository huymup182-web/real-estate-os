import { Column, Entity } from 'typeorm';

import { TenantEntity } from '../database/tenant-entity.js';

/** Bảng customers (TASK-018). Truy vấn luôn qua TenantRepository. */
@Entity({ name: 'customers' })
export class Customer extends TenantEntity {
  @Column({ type: 'varchar' })
  fullName!: string;

  @Column({ type: 'varchar' })
  phone!: string;

  @Column({ type: 'citext', nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', nullable: true })
  purpose!: string | null;

  @Column({ type: 'varchar', nullable: true })
  purchaseTimeline!: string | null;

  @Column({ type: 'varchar', nullable: true })
  source!: string | null;

  @Column({ type: 'uuid', nullable: true })
  agentId!: string | null;

  @Column({ type: 'varchar', default: 'NEW' })
  status!: string;

  @Column({ type: 'text', nullable: true })
  lostReason!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedBy!: string | null;
}
