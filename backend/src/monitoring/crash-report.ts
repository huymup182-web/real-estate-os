import { createHash } from 'node:crypto';

import type { RateLimitRule } from '../common/rate-limit/rate-limiter.js';

/**
 * Giới hạn số báo cáo lỗi (TASK-159), mặc định Claude chọn: một màn hình lỗi lặp lại không làm ngập log.
 * Đã đăng nhập thì đếm theo user (web quản trị gửi qua server của nó nên mọi người dùng chung một IP),
 * chưa đăng nhập thì theo IP.
 */
export const CRASH_REPORT_RATE_LIMITS = {
  perUser: { name: 'crash:user', limit: 30, windowSeconds: 5 * 60 },
  perIp: { name: 'crash:ip', limit: 60, windowSeconds: 5 * 60 },
} as const satisfies Record<string, RateLimitRule>;

/** Số frame đầu của stack dùng để nhóm lỗi. */
const FINGERPRINT_FRAMES = 3;

/** Dòng stack là một frame: `at fn (file:1:2)` (JavaScript) hoặc `#0  fn (file:1:2)` (Dart). */
function isFrame(line: string): boolean {
  return line.startsWith('at ') || /^#\d+\s/.test(line);
}

/**
 * Mã nhóm lỗi: cùng loại lỗi ở cùng chỗ trong code thì cùng mã, để đếm và tìm trong log. Bỏ số (dòng, cột, id
 * trong câu lỗi) để một lỗi không tách thành nhiều nhóm; không có stack thì dùng câu lỗi.
 */
export function crashFingerprint(report: {
  platform: string;
  name: string;
  message: string;
  stack?: string;
}): string {
  const frames = (report.stack ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(isFrame)
    .slice(0, FINGERPRINT_FRAMES);
  const location = frames.length > 0 ? frames.join('\n') : report.message;
  return createHash('sha256')
    .update([report.platform, report.name, location.replace(/\d+/g, '#')].join('\n'))
    .digest('hex')
    .slice(0, 16);
}
