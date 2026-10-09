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
