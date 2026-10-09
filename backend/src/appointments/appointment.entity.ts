import { Column, Entity } from 'typeorm';

import { TenantEntity } from '../database/tenant-entity.js';

/** Bảng appointments (TASK-022): lịch dẫn khách xem BĐS. Truy vấn luôn qua TenantRepository. */
@Entity({ name: 'appointments' })
export class Appointment extends TenantEntity {
  @Column({ type: 'uuid' })
  customerId!: string;

  @Column({ type: 'uuid' })
  propertyId!: string;

  @Column({ type: 'uuid' })
  agentId!: string;

  @Column({ type: 'timestamptz' })
  scheduledAt!: Date;

  @Column({ type: 'smallint', nullable: true })
  durationMinutes!: number | null;

  @Column({ type: 'varchar', nullable: true })
  location!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'varchar', default: 'SCHEDULED' })
  status!: string;

  @Column({ type: 'varchar', nullable: true })
  outcome!: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedBy!: string | null;
}
