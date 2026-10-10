'use client';

import { useEffect } from 'react';

import { errorFields } from '../lib/crash-report.ts';
import { reportCrashAction } from './crash-actions.ts';

/** Gửi lỗi mà error boundary vừa bắt (một lần cho mỗi lỗi). `fatal` khi lỗi ở layout gốc, cả trang hỏng. */
export function useCrashReport(error: Error & { digest?: string }, fatal = false): void {
  useEffect(() => {
    void reportCrashAction({
      ...errorFields(error),
      digest: error.digest,
      route: window.location.pathname,
      fatal,
    }).catch(() => undefined);
  }, [error, fatal]);
}
