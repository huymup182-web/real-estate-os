import Link from 'next/link';

import { currentUser } from '../../../lib/auth/auth-api.ts';
import { hasPermission } from '../../../lib/auth/permissions.ts';
import { accessToken } from '../../../lib/auth/server-session.ts';
import {
  DEAL_STAGE_LABELS,
  dealFilters,
  dealQuery,
  formatMoney,
  listDeals,
} from '../../../lib/deals.ts';

export const dynamic = 'force-dynamic';

const dateFormat = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
});

/** Giao dịch trong phạm vi `deal.view` (TASK-110), mới tạo trước; lọc theo bước và khách (mở từ trang khách). */
export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = dealFilters(params);
  const token = await accessToken();
  const [me, deals] = await Promise.all([currentUser(token), listDeals(token, filters)]);
  const canManage = me.ok && hasPermission(me.data, 'deal.manage');
  const newHref = filters.customerId ? `/deals/new?customerId=${filters.customerId}` : '/deals/new';

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>Giao dịch</h1>
          {deals.ok && <p className="muted">{deals.meta?.total ?? deals.data.length} giao dịch</p>}
        </div>
        {canManage && (
          <Link href={newHref} className="button">
            Tạo giao dịch
          </Link>
        )}
      </div>
      {params['saved'] === 'deleted' && (
        <p className="form-success" role="status">
          Đã xoá giao dịch.
        </p>
      )}

      <form className="filters" role="search">
        <select name="stage" defaultValue={filters.stage} aria-label="Bước giao dịch">
          <option value="">Mọi bước</option>
          {Object.entries(DEAL_STAGE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {filters.customerId && <input type="hidden" name="customerId" value={filters.customerId} />}
        <button type="submit" className="button button-secondary">
          Lọc
        </button>
      </form>
      {filters.customerId && (
        <p className="muted">
          Đang xem giao dịch của một khách.{' '}
          <Link href={`/customers/${filters.customerId}`}>Về trang khách</Link> ·{' '}
          <Link href={`/deals${dealQuery({ ...filters, customerId: '' }, 1)}`}>Xem mọi khách</Link>
        </p>
      )}

      {!deals.ok ? (
        <div className="card">
          <p className="form-error" role="alert">
            {deals.status === 403 ? 'Bạn chưa có quyền xem giao dịch.' : deals.message}
          </p>
        </div>
      ) : deals.data.length === 0 ? (
        <div className="card">
          <p className="muted">Không có giao dịch nào khớp bộ lọc.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Khách</th>
                <th>BĐS</th>
                <th>Giá chốt</th>
                <th>Bước</th>
                <th>Ngày tạo</th>
              </tr>
            </thead>
            <tbody>
              {deals.data.map((deal) => (
                <tr key={deal.id}>
                  <td>
                    <Link href={`/deals/${deal.id}`}>{deal.customer.fullName}</Link>
                  </td>
                  <td>
                    <code>{deal.property.code}</code>
                    <div className="muted">{deal.property.title}</div>
                  </td>
                  <td>{formatMoney(deal.dealPrice)}</td>
                  <td>
                    <span className={`badge badge-deal-${deal.stage.toLowerCase()}`}>
                      {DEAL_STAGE_LABELS[deal.stage] ?? deal.stage}
                    </span>
                    {deal.closedAt && (
                      <div className="muted">{dateFormat.format(new Date(deal.closedAt))}</div>
                    )}
                  </td>
                  <td>{dateFormat.format(new Date(deal.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deals.ok && deals.meta && deals.meta.totalPages > 1 && (
        <nav className="pager" aria-label="Phân trang">
          {filters.page > 1 ? (
            <Link href={`/deals${dealQuery(filters, filters.page - 1)}`}>← Trước</Link>
          ) : (
            <span />
          )}
          <span className="muted">
            Trang {deals.meta.page}/{deals.meta.totalPages}
          </span>
          {filters.page < deals.meta.totalPages ? (
            <Link href={`/deals${dealQuery(filters, filters.page + 1)}`}>Sau →</Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
