import type { RateLimitRule } from '../common/rate-limit/rate-limiter.js';

/**
 * Giới hạn số lần gọi các route xác thực công khai (TASK-155), mặc định Claude chọn, ghi ở
 * docs/security-audit.md. Khoá theo IP và theo tài khoản (email/SĐT viết thường).
 * - Đăng nhập: chỉ đếm lần sai, đăng nhập đúng xoá bộ đếm của tài khoản đó.
 * - Quên mật khẩu, đặt lại mật khẩu: đếm mọi lần gọi, để không dò được mã OTP 6 số bằng cách xin mã mới liên tục
 *   và không gửi email hàng loạt vào một hộp thư.
 */
export const AUTH_RATE_LIMITS = {
  loginFailuresPerAccount: { name: 'login:account', limit: 10, windowSeconds: 15 * 60 },
  loginFailuresPerIp: { name: 'login:ip', limit: 50, windowSeconds: 15 * 60 },
  registerPerIp: { name: 'register:ip', limit: 20, windowSeconds: 60 * 60 },
  refreshPerIp: { name: 'refresh:ip', limit: 300, windowSeconds: 5 * 60 },
  forgotPerEmail: { name: 'forgot:email', limit: 5, windowSeconds: 15 * 60 },
  forgotPerIp: { name: 'forgot:ip', limit: 20, windowSeconds: 15 * 60 },
  resetPerEmail: { name: 'reset:email', limit: 10, windowSeconds: 15 * 60 },
  resetPerIp: { name: 'reset:ip', limit: 30, windowSeconds: 15 * 60 },
} as const satisfies Record<string, RateLimitRule>;

/** Khoá theo tài khoản: không phân biệt hoa thường, bỏ khoảng trắng hai đầu. */
export function accountKey(identifier: string): string {
  return identifier.trim().toLowerCase();
}
