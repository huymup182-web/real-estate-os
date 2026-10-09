/** Danh sách giá trị của khách hàng, khớp CHECK trong migration TASK-018 (docs/database.md mục 4.5). */
export const CUSTOMER_PURPOSES = ['LIVING', 'INVESTMENT', 'RENT', 'OTHER'] as const;

export const PURCHASE_TIMELINES = [
  'IMMEDIATE',
  'WITHIN_3_MONTHS',
  'WITHIN_6_MONTHS',
  'OVER_6_MONTHS',
  'UNKNOWN',
] as const;

export const CUSTOMER_SOURCES = [
  'REFERRAL',
  'WALK_IN',
  'FACEBOOK',
  'ZALO',
  'TIKTOK',
  'WEBSITE',
  'BROKER_PARTNER',
  'OLD_CUSTOMER',
  'OTHER',
] as const;

/** Số điện thoại dạng quốc tế, như cột `phone` trong database. */
export const PHONE_PATTERN = /^\+[0-9]{8,15}$/;
export const PHONE_MESSAGE = 'phone phải theo dạng quốc tế, vd +84901234567';

/** Loại giao dịch khách cần, khớp CHECK của `customer_preferences.transaction_type`. */
export const TRANSACTION_TYPES = ['SALE', 'RENT'] as const;

/** Số nhu cầu tối đa của một khách (mặc định Claude chọn ở TASK-078, đổi được khi có yêu cầu). */
export const MAX_PREFERENCES_PER_CUSTOMER = 20;

/** Loại hoạt động trên timeline của khách, khớp CHECK của `customer_activities.type`. */
export const ACTIVITY_TYPES = [
  'CALL',
  'MESSAGE',
  'PROPERTY_SENT',
  'VIEWING',
  'NEGOTIATION',
  'DEPOSIT',
  'NOTE',
  'STATUS_CHANGE',
  'ASSIGNMENT',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** Loại người dùng tự ghi được (TASK-081). STATUS_CHANGE, ASSIGNMENT do hệ thống ghi khi đổi trạng thái/giao khách. */
export const USER_ACTIVITY_TYPES = [
  'CALL',
  'MESSAGE',
  'PROPERTY_SENT',
  'VIEWING',
  'NEGOTIATION',
  'DEPOSIT',
  'NOTE',
] as const satisfies readonly ActivityType[];

/** Số BĐS tối đa gắn vào một hoạt động. */
export const MAX_ACTIVITY_PROPERTIES = 20;

/** Các bước pipeline khách hàng theo thứ tự (MASTER_PLAN mục 7), khớp CHECK của `customers.status`. */
export const CUSTOMER_STATUSES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'VIEWING',
  'NEGOTIATING',
  'DEPOSIT',
  'WON',
  'LOST',
] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/**
 * Luật chuyển bước pipeline (TASK-082, Huy Lê chọn ngày 2026-10-09): chuyển tự do giữa mọi
 * bước, kể cả lùi bước và mở lại khách đã WON/LOST (như đổi trạng thái BĐS ở TASK-054).
 */
export function canChangeCustomerStatus(from: string, to: CustomerStatus): boolean {
  const statuses: readonly string[] = CUSTOMER_STATUSES;
  return statuses.includes(from) && statuses.includes(to);
}
