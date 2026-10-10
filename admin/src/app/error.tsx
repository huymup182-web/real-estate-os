'use client';

import { useCrashReport } from './use-crash-report.ts';

/**
 * Màn hình khi một trang lỗi không lường trước (TASK-159): báo về backend, cho thử lại. Không hiện chi tiết lỗi;
 * mã `digest` giúp tìm dòng log ở server.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useCrashReport(error);
  return (
    <main>
      <div className="card">
        <h1>Có lỗi xảy ra</h1>
        <p className="form-error" role="alert">
          Trang này gặp lỗi không mong muốn. Lỗi đã được ghi lại, vui lòng thử lại.
        </p>
        {error.digest ? <p className="muted">Mã lỗi: {error.digest}</p> : null}
        <button type="button" className="button" onClick={reset}>
          Thử lại
        </button>
      </div>
    </main>
  );
}
