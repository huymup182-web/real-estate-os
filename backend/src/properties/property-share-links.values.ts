import { createHash, randomBytes } from 'node:crypto';

/** Hạn mặc định và tối đa của link chia sẻ BĐS (ngày, TASK-061). */
export const DEFAULT_SHARE_LINK_DAYS = 30;
export const MAX_SHARE_LINK_DAYS = 90;

/** Token gửi cho khách: 32 byte ngẫu nhiên, base64url (43 ký tự). */
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateShareToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Database chỉ lưu SHA-256 (hex) của token. */
export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
