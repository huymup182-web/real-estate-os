import Link from 'next/link';

import { currentUser } from '../../../lib/auth/auth-api.ts';
import { hasPermission } from '../../../lib/auth/permissions.ts';
import { accessToken } from '../../../lib/auth/server-session.ts';
import {
  listNotifications,
  listSavedSearches,
  NOTIFICATION_TYPE_LABELS,
  notificationFilters,
  notificationLink,
  notificationQuery,
  unreadCount,
} from '../../../lib/notifications.ts';
import { ActionButton } from './action-button.tsx';
import {
  deleteSavedSearchAction,
  markAllReadAction,
  markReadAction,
  openNotificationAction,
  toggleSavedSearchAction,
} from './actions.ts';

export const dynamic = 'force-dynamic';

const timeFormat = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
});

/**
 * Thông báo của người đang đăng nhập (TASK-111): lọc chưa đọc, theo loại; mở thì đánh dấu đã đọc và chuyển
 * tới trang liên quan; đánh dấu đọc tất cả. Cuối trang: bật/tắt nhận tin BĐS mới của các tìm kiếm đã lưu.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = notificationFilters(params);
  const token = await accessToken();
  const [me, notifications, unread] = await Promise.all([
    currentUser(token),
    listNotifications(token, filters),
    unreadCount(token),
  ]);
  const savedSearches =
    me.ok && hasPermission(me.data, 'property.view') ? await listSavedSearches(token) : null;
  const readCount = typeof params['count'] === 'string' ? Number(params['count']) : 0;

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>Thông báo</h1>
          {unread.ok && <p className="muted">{unread.data.count} chưa đọc</p>}
        </div>
        {unread.ok && unread.data.count > 0 && (
          <ActionButton
            action={markAllReadAction}
            label="Đánh dấu đã đọc tất cả"
            pendingLabel="Đang đánh dấu…"
          />
        )}
      </div>
      {params['saved'] === 'read-all' && (
        <p className="form-success" role="status">
          Đã đánh dấu đọc {Number.isInteger(readCount) ? readCount : 0} thông báo.
        </p>
      )}

      <form className="filters" role="search">
        <select name="unread" defaultValue={filters.unread ? 'true' : ''} aria-label="Đã đọc">
          <option value="">Tất cả</option>
          <option value="true">Chưa đọc</option>
        </select>
        <select name="type" defaultValue={filters.type} aria-label="Loại thông báo">
          <option value="">Mọi loại</option>
          {Object.entries(NOTIFICATION_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="submit" className="button button-secondary">
          Lọc
        </button>
      </form>

      {!notifications.ok ? (
        <div className="card">
          <p className="form-error" role="alert">
            {notifications.message}
          </p>
        </div>
      ) : notifications.data.length === 0 ? (
        <div className="card">
          <p className="muted">Không có thông báo nào.</p>
        </div>
      ) : (
        <div className="card">
          <ul className="notification-list">
            {notifications.data.map((notification) => {
              const link = notificationLink(notification);
              return (
                <li
                  key={notification.id}
                  className={notification.readAt ? undefined : 'notification-unread'}
                >
                  <div className="notification-text">
                    <strong>{notification.title}</strong>
                    <p className="prewrap">{notification.body}</p>
                    <p className="muted">
                      {timeFormat.format(new Date(notification.createdAt))} ·{' '}
                      {NOTIFICATION_TYPE_LABELS[notification.type] ?? notification.type}
                    </p>
                  </div>
                  <div className="inline-form">
                    {link && (
                      <ActionButton
                        action={openNotificationAction.bind(null, notification.id)}
                        label="Mở"
                      />
                    )}
                    {!link && !notification.readAt && (
                      <ActionButton
                        action={markReadAction.bind(null, notification.id)}
                        label="Đã đọc"
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {notifications.ok && notifications.meta && notifications.meta.totalPages > 1 && (
        <nav className="pager" aria-label="Phân trang">
          {filters.page > 1 ? (
            <Link href={`/notifications${notificationQuery(filters, filters.page - 1)}`}>
              ← Trước
            </Link>
          ) : (
            <span />
          )}
          <span className="muted">
            Trang {notifications.meta.page}/{notifications.meta.totalPages}
          </span>
          {filters.page < notifications.meta.totalPages ? (
            <Link href={`/notifications${notificationQuery(filters, filters.page + 1)}`}>
              Sau →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      {savedSearches && (
        <section className="card">
          <h2>Nhận tin BĐS mới</h2>
          <p className="muted">
            Tìm kiếm BĐS đã lưu (lưu trên app). Bật thì có thông báo khi có BĐS mới khớp bộ lọc.
          </p>
          {!savedSearches.ok ? (
            <p className="form-error">{savedSearches.message}</p>
          ) : savedSearches.data.length === 0 ? (
            <p className="muted">Chưa có tìm kiếm nào được lưu.</p>
          ) : (
            <ul className="notification-list">
              {savedSearches.data.map((search) => (
                <li key={search.id}>
                  <div className="notification-text">
                    <strong>{search.name}</strong>
                    <p className="muted">
                      {search.notify ? 'Đang nhận tin' : 'Đã tắt'}
                      {search.lastNotifiedAt &&
                        ` · tin gần nhất ${timeFormat.format(new Date(search.lastNotifiedAt))}`}
                    </p>
                  </div>
                  <div className="inline-form">
                    <ActionButton
                      action={toggleSavedSearchAction.bind(null, search.id, !search.notify)}
                      label={search.notify ? 'Tắt nhận tin' : 'Bật nhận tin'}
                    />
                    <ActionButton
                      action={deleteSavedSearchAction.bind(null, search.id)}
                      label="Xoá"
                      className="button button-danger"
                      confirmText={`Xoá tìm kiếm "${search.name}"?`}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
