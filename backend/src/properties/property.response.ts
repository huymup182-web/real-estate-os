import type { Property } from './property.entity.js';

/** BĐS trả cho client. Không có tenantId (client không cần) và các cột sinh cho tìm kiếm/bản đồ. */
export interface PropertyResponse {
  id: string;
  code: string;
  title: string;
  description: string | null;
  transactionType: string;
  propertyType: string;
  price: number;
  area: number;
  pricePerM2: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floors: number | null;
  direction: string | null;
  roadWidth: number | null;
  roadAccess: string | null;
  legalStatus: string | null;
  provinceId: string;
  districtId: string | null;
  wardId: string;
  streetAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
  ownerId: string | null;
  agentId: string;
  source: string | null;
  commissionType: string | null;
  commissionValue: number | null;
  verificationStatus: string;
  lastVerifiedAt: Date | null;
  verifiedBy: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toPropertyResponse(property: Property): PropertyResponse {
  return {
    id: property.id,
    code: property.code,
    title: property.title,
    description: property.description,
    transactionType: property.transactionType,
    propertyType: property.propertyType,
    price: property.price,
    area: property.area,
    pricePerM2: property.pricePerM2,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    floors: property.floors,
    direction: property.direction,
    roadWidth: property.roadWidth,
    roadAccess: property.roadAccess,
    legalStatus: property.legalStatus,
    provinceId: property.provinceId,
    districtId: property.districtId,
    wardId: property.wardId,
    streetAddress: property.streetAddress,
    latitude: property.latitude,
    longitude: property.longitude,
    status: property.status,
    ownerId: property.ownerId,
    agentId: property.agentId,
    source: property.source,
    commissionType: property.commissionType,
    commissionValue: property.commissionValue,
    verificationStatus: property.verificationStatus,
    lastVerifiedAt: property.lastVerifiedAt,
    verifiedBy: property.verifiedBy,
    createdBy: property.createdBy,
    updatedBy: property.updatedBy,
    createdAt: property.createdAt,
    updatedAt: property.updatedAt,
  };
}
