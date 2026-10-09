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
  notes: string | null;
}

/**
 * Chi tiết BĐS (TASK-050). Người không có quyền xem liên hệ chủ nhà với BĐS này
 * (`ownerContactVisible = false`) nhận `streetAddress`, `ownerId`, `owner` là null.
 * Toạ độ vẫn trả cho mọi người xem được BĐS để cắm điểm bản đồ (Huy Lê chọn ngày 2026-10-04).
 */
export interface PropertyDetailResponse extends PropertyResponse {
  ownerContactVisible: boolean;
  owner: PropertyOwnerContact | null;
  /** User đang xem đã lưu BĐS này vào danh sách yêu thích chưa (TASK-059). */
  isFavorite: boolean;
}

/** `GET /properties/:id` (và các API trả lại chi tiết): thêm tên tỉnh, phường/xã cho app (TASK-121). */
export interface PropertyDetailView extends PropertyDetailResponse {
  provinceName: string;
  wardName: string;
}

/** Cờ riêng theo người xem của một BĐS. */
export interface PropertyViewerFlags {
  ownerContactVisible: boolean;
  isFavorite: boolean;
}

export function toPropertyDetailResponse(
  property: Property,
  owner: PropertyOwnerContact | null,
  flags: PropertyViewerFlags,
): PropertyDetailResponse {
  const item = toPropertyListItem(property, flags);
  const { ownerContactVisible } = flags;
  return { ...item, owner: ownerContactVisible ? owner : null };
}

/**
 * Một dòng trong danh sách BĐS (TASK-051): như chi tiết nhưng không kèm thông tin chủ nhà;
 * địa chỉ chi tiết và `ownerId` ẩn theo cùng quy tắc với chi tiết.
 */
export type PropertyListItem = Omit<PropertyDetailResponse, 'owner'>;

/** Ảnh bìa của BĐS trong danh sách (TASK-118); `thumbnailUrl` null khi chưa có ảnh nhỏ. */
export interface PropertyCoverImage {
  url: string;
  thumbnailUrl: string | null;
}

/**
 * Dòng của `GET /properties` và `GET /properties/favorites`: thêm tên tỉnh, phường/xã và ảnh bìa để app hiện
 * thẻ BĐS không phải gọi thêm (TASK-118).
 */
export interface PropertyListRow extends PropertyListItem {
  provinceName: string;
  wardName: string;
  coverImage: PropertyCoverImage | null;
}

export function toPropertyListItem(
  property: Property,
  { ownerContactVisible, isFavorite }: PropertyViewerFlags,
): PropertyListItem {
  const base = toPropertyResponse(property);
  if (!ownerContactVisible) {
    return { ...base, streetAddress: null, ownerId: null, ownerContactVisible, isFavorite };
  }
  return { ...base, ownerContactVisible, isFavorite };
}
