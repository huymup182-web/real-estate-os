import type { NextConfig } from 'next';

/** Cấu hình Next.js cho web quản trị (TASK-100). Admin chỉ gọi Backend API, không truy cập database. */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
