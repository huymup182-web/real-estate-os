import { backendStatus } from '../lib/backend.ts';

/** Luôn render lúc request để tình trạng backend là hiện tại. */
export const dynamic = 'force-dynamic';

/** Trang chủ tạm (TASK-100): xác nhận admin chạy và gọi được Backend API. Đăng nhập làm ở TASK-101. */
export default async function HomePage() {
  const status = await backendStatus();
  return (
    <main>
      <div className="card">
        <h1>AI Real Estate OS</h1>
        <p className="muted">Web quản trị đang được xây dựng.</p>
        <p>
          Backend API:{' '}
          {status === 'up' ? (
            <strong className="status-up">đang hoạt động</strong>
          ) : (
            <strong className="status-down">không kết nối được</strong>
          )}
        </p>
      </div>
    </main>
  );
}
