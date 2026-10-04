/**
 * Danh sách giá trị của BĐS, khớp CHECK trong database (database/migrations/…-create-properties.ts,
 * Huy Lê duyệt ngày 2026-10-04, docs/database.md mục 4.4).
 */
export const PROPERTY_TYPES = [
  'HOUSE',
  'APARTMENT',
  'VILLA',
  'SHOPHOUSE',
  'LAND',
  'LAND_PLOT',
  'AGRICULTURAL_LAND',
  'WAREHOUSE',
  'OTHER',
] as const;

export const LEGAL_STATUSES = [
  'PRIVATE_BOOK',
  'SHARED_BOOK',
  'PENDING_BOOK',
  'SALE_CONTRACT',
  'HANDWRITTEN',
  'OTHER',
] as const;

export const PROPERTY_SOURCES = [
  'OWNER_DIRECT',
  'SELF_SOURCED',
  'BROKER_PARTNER',
  'REFERRAL',
  'ONLINE_LISTING',
  'OTHER',
] as const;

export const DIRECTIONS = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'] as const;
export const ROAD_ACCESSES = ['CAR', 'MOTORBIKE', 'WALK'] as const;
export const COMMISSION_TYPES = ['PERCENT', 'FIXED'] as const;

/** Mã BĐS hiển thị: tiền tố + số thứ tự theo công ty, đệm 6 chữ số (vd `BDS-000125`). */
export const PROPERTY_CODE_PREFIX = 'BDS-';
export function formatPropertyCode(value: number): string {
  return `${PROPERTY_CODE_PREFIX}${String(value).padStart(6, '0')}`;
}

export const PROPERTY_STATUSES = [
  'AVAILABLE',
  'PENDING',
  'SOLD',
  'HIDDEN',
  'EXPIRED',
  'VERIFY_REQUIRED',
] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

/**
 * Trạng thái người dùng tự đặt được (TASK-054, Huy Lê chọn ngày 2026-10-04): chuyển tự do giữa 4 trạng thái
 * này. EXPIRED, VERIFY_REQUIRED chỉ hệ thống đặt (quá hạn xác minh).
 */
export const USER_SETTABLE_STATUSES = ['AVAILABLE', 'PENDING', 'SOLD', 'HIDDEN'] as const;

/** Trạng thái chờ xác minh lại: muốn mở bán lại (AVAILABLE, PENDING) phải xác minh (TASK-062). */
const NEEDS_VERIFICATION: readonly string[] = ['EXPIRED', 'VERIFY_REQUIRED'];
const OPEN_FOR_SALE: readonly string[] = ['AVAILABLE', 'PENDING'];

/** Người dùng có được chuyển BĐS từ `from` sang `to` không. Trạng thái `to` đã thuộc USER_SETTABLE_STATUSES. */
export function canUserChangeStatus(from: string, to: string): boolean {
  return !(NEEDS_VERIFICATION.includes(from) && OPEN_FOR_SALE.includes(to));
}
