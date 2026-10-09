import Link from 'next/link';

import {
  APPOINTMENT_STATUS_LABELS,
  appointmentFilters,
  appointmentQuery,
  listAppointments,
  OUTCOME_LABELS,
} from '../../../lib/appointments.ts';
import { currentUser } from '../../../lib/auth/auth-api.ts';
import { hasPermission } from '../../../lib/auth/permissions.ts';
import { accessToken } from '../../../lib/auth/server-session.ts';
import { timeFormat } from './format.ts';

export const dynamic = 'force-dynamic';

/**
 * Lịch hẹn trong phạm vi `appointment.view` (TASK-109), giờ hẹn sớm trước. Mặc định xem từ hôm nay; lọc theo
 * khoảng ngày, trạng thái và khách (mở từ trang khách).
 */
export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = appointmentFilters(params);
  const token = await accessToken();
  const [me, appointments] = await Promise.all([
    currentUser(token),
    listAppointments(token, filters),
  ]);
  const canManage = me.ok && hasPermission(me.data, 'appointment.manage');
  const newHref = filters.customerId
    ? `/appointments/new?customerId=${filters.customerId}`
    : '/appointments/new';

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>Lịch hẹn</h1>
          {appointments.ok && (
            <p className="muted">{appointments.meta?.total ?? appointments.data.length} lịch hẹn</p>
          )}
        </div>
        {canManage && (
          <Link href={newHref} className="button">
            Đặt lịch hẹn
          </Link>
        )}
      </div>
      {params['saved'] === 'deleted' && (
        <p className="form-success" role="status">
          Đã xoá lịch hẹn.
        </p>
      )}

      <form className="filters" role="search">
        <label className="filter-date">
          <span>Từ ngày</span>
          <input name="from" type="date" defaultValue={filters.from} />
        </label>
        <label className="filter-date">
          <span>Đến ngày</span>
          <input name="to" type="date" defaultValue={filters.to} />
        </label>
        <select name="status" defaultValue={filters.status} aria-label="Trạng thái">
          <option value="">Mọi trạng thái</option>
          {Object.entries(APPOINTMENT_STATUS_LABELS).map(([value, label]) => (
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
          Đang xem lịch của một khách.{' '}
          <Link href={`/customers/${filters.customerId}`}>Về trang khách</Link> ·{' '}
          <Link href={appointmentQuery({ ...filters, customerId: '' }, 1)}>Xem mọi khách</Link>
        </p>
      )}

      {!appointments.ok ? (
        <div className="card">
          <p className="form-error" role="alert">
            {appointments.status === 403 ? 'Bạn chưa có quyền xem lịch hẹn.' : appointments.message}
          </p>
        </div>
      ) : appointments.data.length === 0 ? (
        <div className="card">
          <p className="muted">Không có lịch hẹn nào khớp bộ lọc.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Giờ hẹn</th>
                <th>Khách</th>
                <th>BĐS</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {appointments.data.map((appointment) => (
                <tr key={appointment.id}>
                  <td>
                    <Link href={`/appointments/${appointment.id}`}>
                      {timeFormat.format(new Date(appointment.scheduledAt))}
                    </Link>
                  </td>
                  <td>{appointment.customer.fullName}</td>
                  <td>
                    <code>{appointment.property.code}</code>
                    <div className="muted">{appointment.property.title}</div>
                  </td>
                  <td>
                    <span className={`badge badge-appointment-${appointment.status.toLowerCase()}`}>
                      {APPOINTMENT_STATUS_LABELS[appointment.status] ?? appointment.status}
                    </span>
                    {appointment.outcome && (
                      <div className="muted">
                        {OUTCOME_LABELS[appointment.outcome] ?? appointment.outcome}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {appointments.ok && appointments.meta && appointments.meta.totalPages > 1 && (
        <nav className="pager" aria-label="Phân trang">
          {filters.page > 1 ? (
            <Link href={`/appointments${appointmentQuery(filters, filters.page - 1)}`}>
              ← Trước
            </Link>
          ) : (
            <span />
          )}
          <span className="muted">
            Trang {appointments.meta.page}/{appointments.meta.totalPages}
          </span>
          {filters.page < appointments.meta.totalPages ? (
            <Link href={`/appointments${appointmentQuery(filters, filters.page + 1)}`}>Sau →</Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
