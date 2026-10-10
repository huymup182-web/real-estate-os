'use server';

import { accessToken } from '../lib/auth/server-session.ts';
import { buildCrashReport, type CrashInput, sendCrashReport } from '../lib/crash-report.ts';

/**
 * Gửi lỗi xảy ra ở trình duyệt về backend (TASK-159). Trình duyệt không gọi thẳng backend nên đi qua server của
 * admin, kèm access token (nếu đã đăng nhập) để log có tenant và user.
 */
export async function reportCrashAction(input: CrashInput): Promise<void> {
  await sendCrashReport(buildCrashReport(input), (await accessToken()) || undefined);
}
