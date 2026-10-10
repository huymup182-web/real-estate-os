'use client';

import './globals.css';

import { useCrashReport } from './use-crash-report.ts';

/** Lỗi ở layout gốc (TASK-159): thay cả trang nên phải tự có `<html>`, `<body>`. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useCrashReport(error, true);
  return (
    <html lang="vi">
      <body>
        <main>
          <div className="card">
            <h1>Có lỗi xảy ra</h1>
            <p className="form-error" role="alert">
              Web quản trị gặp lỗi không mong muốn. Lỗi đã được ghi lại, vui lòng tải lại trang.
            </p>
            {error.digest ? <p className="muted">Mã lỗi: {error.digest}</p> : null}
            <button type="button" className="button" onClick={reset}>
              Thử lại
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
