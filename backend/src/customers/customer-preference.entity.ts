import { Column, Entity, type ValueTransformer } from 'typeorm';

import { TenantEntity } from '../database/tenant-entity.js';

/** PostgreSQL trả numeric/bigint dạng chuỗi; đổi sang number. */
const toNumber: ValueTransformer = {
  to: (value: unknown) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

/** Bảng customer_preferences (TASK-018): nhu cầu của khách, đầu vào của matching (Phase 7). */
@Entity({ name: 'customer_preferences' })
export class CustomerPreference extends TenantEntity {
  @Column({ type: 'uuid', update: false })
  customerId!: string;

  @Column({ type: 'varchar', default: 'SALE' })
  transactionType!: string;

  @Column({ type: 'varchar', array: true, nullable: true })
  propertyTypes!: string[] | null;

  @Column({ type: 'bigint', nullable: true, transformer: toNumber })
  budgetMin!: number | null;

  @Column({ type: 'bigint', nullable: true, transformer: toNumber })
  budgetMax!: number | null;

  @Column({ type: 'numeric', nullable: true, transformer: toNumber })
  areaMin!: number | null;

  @Column({ type: 'numeric', nullable: true, transformer: toNumber })
  areaMax!: number | null;

  @Column({ type: 'smallint', nullable: true })
  bedroomsMin!: number | null;

  @Column({ type: 'uuid', array: true, nullable: true })
  provinceIds!: string[] | null;

  @Column({ type: 'uuid', array: true, nullable: true })
  districtIds!: string[] | null;

  @Column({ type: 'uuid', array: true, nullable: true })
  wardIds!: string[] | null;

  @Column({ type: 'varchar', array: true, nullable: true })
  directions!: string[] | null;

  @Column({ type: 'varchar', array: true, nullable: true })
  legalStatuses!: string[] | null;

  @Column({ type: 'varchar', nullable: true })
  minRoadAccess!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}

/** Nhu cầu trả cho client (không có tenantId, deletedAt). */
export interface CustomerPreferenceResponse {
  id: string;
  customerId: string;
  transactionType: string;
  propertyTypes: string[] | null;
  budgetMin: number | null;
  budgetMax: number | null;
  areaMin: number | null;
  areaMax: number | null;
  bedroomsMin: number | null;
  provinceIds: string[] | null;
  districtIds: string[] | null;
  wardIds: string[] | null;
  directions: string[] | null;
  legalStatuses: string[] | null;
  minRoadAccess: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function toPreferenceResponse(preference: CustomerPreference): CustomerPreferenceResponse {
  return {
    id: preference.id,
    customerId: preference.customerId,
    transactionType: preference.transactionType,
    propertyTypes: preference.propertyTypes,
    budgetMin: preference.budgetMin,
    budgetMax: preference.budgetMax,
    areaMin: preference.areaMin,
    areaMax: preference.areaMax,
    bedroomsMin: preference.bedroomsMin,
    provinceIds: preference.provinceIds,
    districtIds: preference.districtIds,
    wardIds: preference.wardIds,
    directions: preference.directions,
    legalStatuses: preference.legalStatuses,
    minRoadAccess: preference.minRoadAccess,
    isActive: preference.isActive,
    createdAt: preference.createdAt,
    updatedAt: preference.updatedAt,
  };
}
