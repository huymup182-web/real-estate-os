'use client';

import { useEffect } from 'react';

import { crashThrottle, errorFields } from '../lib/crash-report.ts';
import { reportCrashAction } from './crash-actions.ts';

/**
 * Bắt lỗi JavaScript ngoài error boundary (trong sự kiện click, promise không có `catch`) và gửi về backend
 * (TASK-159). Mỗi lỗi chỉ gửi một lần, tối đa vài báo cáo mỗi lần mở trang.
 */
export function CrashListener() {
  useEffect(() => {
    const allow = crashThrottle();
    const report = (error: unknown): void => {
      const fields = errorFields(error);
      if (!allow(`${String(fields.name)}:${String(fields.message)}`)) {
        return;
      }
      void reportCrashAction({ ...fields, route: window.location.pathname }).catch(() => undefined);
    };
    const onError = (event: ErrorEvent): void => report(event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent): void => report(event.reason);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
