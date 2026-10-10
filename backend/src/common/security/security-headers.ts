import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Header bảo mật cho mọi response của API (TASK-155). API chỉ trả JSON, nên chặn hẳn việc nhúng vào trang
 * khác, chạy script hay đoán kiểu nội dung. HSTS chỉ bật ở production (chạy sau HTTPS).
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/** HSTS: trình duyệt chỉ dùng HTTPS với domain API trong 1 năm. */
export const HSTS_HEADER = 'max-age=31536000; includeSubDomains';

export function securityHeaders(
  production: boolean,
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  return (_req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      res.setHeader(name, value);
    }
    if (production) {
      res.setHeader('Strict-Transport-Security', HSTS_HEADER);
    }
    next();
  };
}
