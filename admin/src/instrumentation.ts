import type { Instrumentation } from 'next';

import { ACCESS_COOKIE } from './lib/auth/session-cookies.ts';
import { buildCrashReport, errorFields, sendCrashReport } from './lib/crash-report.ts';

/** Access token trong header `cookie` của request lỗi, để log có tenant và user. */
export function accessTokenFromCookie(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header.join('; ') : (header ?? '');
  for (const part of value.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === ACCESS_COOKIE && rest.length > 0) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return undefined;
}

/**
 * Lỗi ở server của admin khi render trang, chạy server action hay route (TASK-159): gửi về backend cùng chỗ với lỗi
 * trình duyệt. `routePath` là tên route của Next.js (vd `/properties/[id]`), không có id thật.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const digest = (error as { digest?: unknown } | null)?.digest;
  await sendCrashReport(
    buildCrashReport({ ...errorFields(error), route: context.routePath, digest }),
    accessTokenFromCookie(request.headers['cookie']),
  );
};
