import Link from 'next/link';

import {
  ENTITY_TYPE_LABELS,
  actionLabel,
  auditFilters,
  auditQuery,
  changeRows,
  entityHref,
  entityLabel,
  listAuditLogs,
} from '../../../lib/audit-logs.ts';
import { accessToken } from '../../../lib/auth/server-session.ts';

export const dynamic = 'force-dynamic';

const timeFormat = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'Asia/Ho_Chi_Minh',
});

/**
 * Nhật ký thao tác (TASK-112), quyền `audit.view`, mới nhất trước. Lọc theo loại đối tượng, thao tác, khoảng
 * ngày; bấm tên người hoặc "Lịch sử" của một đối tượng để lọc theo người hoặc đối tượng đó.
 */
export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = auditFilters(await searchParams);
  const logs = await listAuditLogs(await accessToken(), filters);
  const filteredUser =
    filters.userId && logs.ok
      ? logs.data.find((log) => log.user?.id === filters.userId)?.user?.fullName
      : undefined;

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>Nhật ký thao tác</h1>
          {logs.ok && <p className="muted">{logs.meta?.total ?? logs.data.length} dòng</p>}
        </div>
      </div>

      <form className="filters" role="search">
        <select name="entityType" defaultValue={filters.entityType} aria-label="Loại đối tượng">
          <option value="">Mọi đối tượng</option>
          {Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          name="action"
          defaultValue={filters.action}
          placeholder="Mã thao tác, vd property.update"
          aria-label="Mã thao tác"
        />
        <label className="filter-date">
          <span>Từ ngày</span>
          <input name="from" type="date" defaultValue={filters.from} />
        </label>
        <label className="filter-date">
          <span>Đến ngày</span>
          <input name="to" type="date" defaultValue={filters.to} />
        </label>
        {filters.userId && <input type="hidden" name="userId" value={filters.userId} />}
        {filters.entityId && <input type="hidden" name="entityId" value={filters.entityId} />}
        <button type="submit" className="button button-secondary">
          Lọc
        </button>
      </form>
      {filters.userId && (
        <p className="muted">
          Đang xem thao tác của {filteredUser ?? 'một người'}.{' '}
          <Link href={`/audit-logs${auditQuery(filters, 1, { userId: '' })}`}>Bỏ lọc người</Link>
        </p>
      )}
      {filters.entityId && (
        <p className="muted">
          Đang xem lịch sử của một đối tượng.{' '}
          <Link href={`/audit-logs${auditQuery(filters, 1, { entityId: '' })}`}>
            Bỏ lọc đối tượng
          </Link>
        </p>
      )}

      {!logs.ok ? (
        <div className="card">
          <p className="form-error" role="alert">
            {logs.status === 403 ? 'Bạn chưa có quyền xem nhật ký.' : logs.message}
          </p>
        </div>
      ) : logs.data.length === 0 ? (
        <div className="card">
          <p className="muted">Không có dòng nhật ký nào khớp bộ lọc.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table audit-table">
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Người</th>
                <th>Thao tác</th>
                <th>Đối tượng</th>
                <th>Thay đổi</th>
              </tr>
            </thead>
            <tbody>
              {logs.data.map((log) => {
                const href = entityHref(log.entityType, log.entityId);
                const rows = changeRows(log.changes);
                return (
                  <tr key={log.id}>
                    <td>
                      {timeFormat.format(new Date(log.createdAt))}
                      {log.ipAddress && <div className="muted">{log.ipAddress}</div>}
                    </td>
                    <td>
                      {log.user ? (
                        <Link
                          href={`/audit-logs${auditQuery(filters, 1, { userId: log.user.id })}`}
                        >
                          {log.user.fullName}
                        </Link>
                      ) : (
                        <span className="muted">Hệ thống</span>
                      )}
                    </td>
                    <td>
                      {actionLabel(log.action)}
                      <div>
                        <code>{log.action}</code>
                      </div>
                    </td>
                    <td>
                      {href ? (
                        <Link href={href}>{entityLabel(log.entityType)}</Link>
                      ) : (
                        entityLabel(log.entityType)
                      )}
                      {log.entityId && (
                        <div>
                          <Link
                            className="muted"
                            href={`/audit-logs${auditQuery(filters, 1, {
                              entityType: '',
                              entityId: log.entityId,
                              userId: '',
                              action: '',
                            })}`}
                          >
                            Lịch sử
                          </Link>
                        </div>
                      )}
                    </td>
                    <td>
                      {rows.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        <ul className="audit-changes">
                          {rows.map(([field, before, after]) => (
                            <li key={field}>
                              <code>{field}</code>: {before} → {after}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {logs.ok && logs.meta && logs.meta.totalPages > 1 && (
        <nav className="pager" aria-label="Phân trang">
          {filters.page > 1 ? (
            <Link href={`/audit-logs${auditQuery(filters, filters.page - 1)}`}>← Trước</Link>
          ) : (
            <span />
          )}
          <span className="muted">
            Trang {logs.meta.page}/{logs.meta.totalPages}
          </span>
          {filters.page < logs.meta.totalPages ? (
            <Link href={`/audit-logs${auditQuery(filters, filters.page + 1)}`}>Sau →</Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
