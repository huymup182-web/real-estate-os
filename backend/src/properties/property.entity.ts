import { Column, Entity, type ValueTransformer } from 'typeorm';

import { TenantEntity } from '../database/tenant-entity.js';

/** PostgreSQL trả numeric/bigint dạng chuỗi; đổi sang number (giá tiền VNĐ nằm trong giới hạn số nguyên an toàn của JS). */
const toNumber: ValueTransformer = {
  to: (value: unknown) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

/**
 * Bảng properties (TASK-014). Chỉ khai báo cột backend dùng; cột sinh tự động `location`, `search_vector`
 * không ánh xạ. Truy vấn luôn qua TenantRepository.
 */
@Entity({ name: 'properties' })
export class Property extends TenantEntity {
  @Column({ type: 'varchar' })
  code!: string;

  @Column({ type: 'varchar' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', default: 'SALE' })
  transactionType!: string;

  @Column({ type: 'varchar' })
  propertyType!: string;

  @Column({ type: 'bigint', transformer: toNumber })
  price!: number;

  @Column({ type: 'numeric', transformer: toNumber })
  area!: number;

  @Column({ type: 'bigint', insert: false, update: false, nullable: true, transformer: toNumber })
  pricePerM2!: number | null;

  @Column({ type: 'smallint', nullable: true })
  bedrooms!: number | null;

  @Column({ type: 'smallint', nullable: true })
  bathrooms!: number | null;

  @Column({ type: 'smallint', nullable: true })
  floors!: number | null;

  @Column({ type: 'varchar', nullable: true })
  direction!: string | null;

  @Column({ type: 'numeric', nullable: true, transformer: toNumber })
  roadWidth!: number | null;

  @Column({ type: 'varchar', nullable: true })
  roadAccess!: string | null;

  @Column({ type: 'varchar', nullable: true })
  legalStatus!: string | null;

  @Column({ type: 'uuid' })
  provinceId!: string;

  @Column({ type: 'uuid', nullable: true })
  districtId!: string | null;

  @Column({ type: 'uuid' })
  wardId!: string;

  @Column({ type: 'varchar', nullable: true })
  streetAddress!: string | null;

  @Column({ type: 'numeric', nullable: true, transformer: toNumber })
  latitude!: number | null;

  @Column({ type: 'numeric', nullable: true, transformer: toNumber })
  longitude!: number | null;

  @Column({ type: 'varchar', default: 'AVAILABLE' })
  status!: string;

  @Column({ type: 'uuid', nullable: true })
  ownerId!: string | null;

  @Column({ type: 'uuid' })
  agentId!: string;

  @Column({ type: 'varchar', nullable: true })
  source!: string | null;

  @Column({ type: 'varchar', nullable: true })
  commissionType!: string | null;

  @Column({ type: 'numeric', nullable: true, transformer: toNumber })
  commissionValue!: number | null;

  @Column({ type: 'varchar', default: 'UNVERIFIED' })
  verificationStatus!: string;

  @Column({ type: 'timestamptz', nullable: true })
  lastVerifiedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  verifiedBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedBy!: string | null;
}
