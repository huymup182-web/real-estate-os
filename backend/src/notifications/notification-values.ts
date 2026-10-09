/** Loại thông báo, khớp CHECK của `notifications.type` (TASK-024, master plan mục 12). */
export const NOTIFICATION_TYPES = [
  'NEW_PROPERTY',
  'PROPERTY_UPDATED',
  'MATCHED_PROPERTY',
  'CUSTOMER_ASSIGNED',
  'NEW_LEAD',
  'VIEWING_REMINDER',
  'VERIFY_REQUIRED',
  'SYSTEM_NOTIFICATION',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Độ dài tiêu đề, khớp cột `notifications.title` varchar(255). */
export const NOTIFICATION_TITLE_MAX = 255;
/** Độ dài nội dung tối đa (mặc định Claude chọn ở TASK-092; cột là text). */
export const NOTIFICATION_BODY_MAX = 2000;
/** Kích thước tối đa của `data` khi đổi sang JSON, tính theo ký tự (mặc định Claude chọn ở TASK-092). */
export const NOTIFICATION_DATA_MAX = 4000;
/** Số người nhận tối đa mỗi lần gửi (mặc định Claude chọn ở TASK-092). */
export const MAX_NOTIFICATION_RECIPIENTS = 1000;
