import Link from 'next/link';

import { currentUser } from '../../../lib/auth/auth-api.ts';
import { hasPermission } from '../../../lib/auth/permissions.ts';
import { accessToken } from '../../../lib/auth/server-session.ts';
import {
  CUSTOMER_STATUS_LABELS,
  customerFilters,
  customerQuery,
  getPipeline,
  listCustomers,
  SOURCE_LABELS,
} from '../../../lib/customers.ts';

export const dynamic = 'force-dynamic';

const dateFormat = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
});

/**
 * Danh sách khách trong phạm vi `customer.view` (TASK-108): số khách theo từng bước pipeline (bấm để lọc),
 * tìm theo tên, SĐT, email.
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = customerFilters(params);
  const token = await accessToken();
  const [me, customers, pipeline] = await Promise.all([
    currentUser(token),
    listCustomers(token, filters),
    getPipeline(token),
  ]);
  const canCreate = me.ok && hasPermission(me.data, 'customer.create');

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>Khách hàng</h1>
          {customers.ok && (
            <p className="muted">{customers.meta?.total ?? customers.data.length} khách</p>
          )}
        </div>
        {canCreate && (
          <Link href="/customers/new" className="button">
            Thêm khách hàng
          </Link>
        )}
      </div>
      {params['saved'] === 'deleted' && (
        <p className="form-success" role="status">
          Đã xoá khách hàng.
        </p>
      )}

      {pipeline.ok && (
        <nav className="pipeline" aria-label="Pipeline khách hàng">
          {pipeline.data.map((stage) => (
            <Link
              key={stage.status}
              href={`/customers${customerQuery({ ...filters, status: stage.status }, 1)}`}
              className="pipeline-stage"
              aria-current={filters.status === stage.status ? 'true' : undefined}
            >
              <span>{CUSTOMER_STATUS_LABELS[stage.status] ?? stage.status}</span>
              <strong>{stage.count}</strong>
            </Link>
          ))}
        </nav>
      )}

      <form className="filters" role="search">
        <input
          name="q"
          type="search"
          defaultValue={filters.q}
          placeholder="Tên, số điện thoại, email"
          aria-label="Tìm khách hàng"
        />
        <select name="status" defaultValue={filters.status} aria-label="Bước pipeline">
          <option value="">Mọi bước</option>
          {Object.entries(CUSTOMER_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="submit" className="button button-secondary">
          Lọc
        </button>
      </form>

      {!customers.ok ? (
        <div className="card">
          <p className="form-error" role="alert">
            {customers.status === 403 ? 'Bạn chưa có quyền xem khách hàng.' : customers.message}
          </p>
        </div>
      ) : customers.data.length === 0 ? (
        <div className="card">
          <p className="muted">Không có khách nào khớp bộ lọc.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Họ tên</th>
                <th>Điện thoại</th>
                <th>Bước</th>
                <th>Nguồn</th>
                <th>Ngày tạo</th>
              </tr>
            </thead>
            <tbody>
              {customers.data.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <Link href={`/customers/${customer.id}`}>{customer.fullName}</Link>
                    {customer.email && <div className="muted">{customer.email}</div>}
                  </td>
                  <td>{customer.phone}</td>
                  <td>
                    <span className={`badge badge-customer-${customer.status.toLowerCase()}`}>
                      {CUSTOMER_STATUS_LABELS[customer.status] ?? customer.status}
                    </span>
                  </td>
                  <td>
                    {customer.source ? (SOURCE_LABELS[customer.source] ?? customer.source) : '—'}
                  </td>
                  <td>{dateFormat.format(new Date(customer.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {customers.ok && customers.meta && customers.meta.totalPages > 1 && (
        <nav className="pager" aria-label="Phân trang">
          {filters.page > 1 ? (
            <Link href={`/customers${customerQuery(filters, filters.page - 1)}`}>← Trước</Link>
          ) : (
            <span />
          )}
          <span className="muted">
            Trang {customers.meta.page}/{customers.meta.totalPages}
          </span>
          {filters.page < customers.meta.totalPages ? (
            <Link href={`/customers${customerQuery(filters, filters.page + 1)}`}>Sau →</Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
