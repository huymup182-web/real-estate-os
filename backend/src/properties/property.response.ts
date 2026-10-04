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

/** Chủ nhà: chỉ trả cho người có quyền `property.view_owner_contact` với BĐS này. */
export interface PropertyOwnerContact {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
}

/**
 * Chi tiết BĐS (TASK-050). Người không có quyền xem liên hệ chủ nhà với BĐS này
 * (`ownerContactVisible = false`) nhận `streetAddress`, `ownerId`, `owner` là null.
 * Toạ độ vẫn trả cho mọi người xem được BĐS để cắm điểm bản đồ (Huy Lê chọn ngày 2026-10-04).
 */
export interface PropertyDetailResponse extends PropertyResponse {
  ownerContactVisible: boolean;
  owner: PropertyOwnerContact | null;
}

export function toPropertyDetailResponse(
  property: Property,
  owner: PropertyOwnerContact | null,
  ownerContactVisible: boolean,
): PropertyDetailResponse {
  const base = toPropertyResponse(property);
  if (!ownerContactVisible) {
    return {
      ...base,
      streetAddress: null,
      ownerId: null,
      ownerContactVisible,
      owner: null,
    };
  }
  return { ...base, ownerContactVisible, owner };
}
