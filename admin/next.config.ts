import type { NextConfig } from 'next';

/**
 * Header bảo mật cho mọi trang của web quản trị (TASK-155): không cho nhúng vào trang khác (chống clickjacking),
 * không đoán kiểu nội dung, không gửi đường dẫn đầy đủ sang trang khác, chỉ gửi form về chính site. HSTS chỉ
 * bật ở production (chạy sau HTTPS). Ảnh BĐS tải từ object storage nên không giới hạn nguồn ảnh.
 */
export function securityHeaders(production: boolean): { key: string; value: string }[] {
  return [
    {
      key: 'Content-Security-Policy',
      value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
    },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ...(production
      ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
      : []),
  ];
}

/** Cấu hình Next.js cho web quản trị (TASK-100). Admin chỉ gọi Backend API, không truy cập database. */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  headers: () =>
    Promise.resolve([
      { source: '/:path*', headers: securityHeaders(process.env.NODE_ENV === 'production') },
    ]),
};

export default nextConfig;
