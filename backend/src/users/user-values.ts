/** Trạng thái tài khoản (bảng users). Chỉ ACTIVE đăng nhập và gọi API được. */
export const USER_STATUSES = ['ACTIVE', 'INACTIVE', 'LOCKED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Số role tối đa gán cho một user trong một lần. */
export const MAX_USER_ROLES = 10;

export const PHONE_PATTERN = /^\+[0-9]{8,15}$/;
export const PHONE_MESSAGE = 'phone phải theo dạng quốc tế, vd +84901234567';
