import Link from 'next/link';

import { accessToken } from '../../lib/auth/server-session.ts';
import {
  barWidths,
  CUSTOMER_STATUS_LABELS,
  type Dashboard,
  DEAL_STAGE_LABELS,
  fetchDashboard,
  formatCount,
  formatVnd,
  PERIOD_OPTIONS,
  periodDays,
  SCOPE_LABELS,
} from '../../lib/dashboard.ts';

/** Luôn render lúc request vì nội dung phụ thuộc người đăng nhập. */
export const dynamic = 'force-dynamic';

function Funnel({ rows }: { rows: { label: string; count: number; note?: string }[] }) {
  const widths = barWidths(rows.map((row) => row.count));
  return (
    <ul className="funnel">
      {rows.map((row, index) => (
        <li key={row.label}>
          <span className="funnel-label">{row.label}</span>
          <span className="funnel-track">
            <span className="funnel-bar" style={{ width: `${widths[index]}%` }} />
          </span>
          <span className="funnel-value">
            {formatCount(row.count)}
            {row.note && <span className="muted"> · {row.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Stats({ data }: { data: Dashboard }) {
  const tiles = [
    { label: 'Tổng BĐS', value: formatCount(data.properties.total) },
    { label: 'BĐS mới', value: formatCount(data.properties.new), period: true },
    { label: 'BĐS đang bán', value: formatCount(data.properties.active) },
    { label: 'Khách hàng', value: formatCount(data.customers.total) },
    { label: 'Lead mới', value: formatCount(data.customers.new), period: true },
    { label: 'Lịch dẫn khách', value: formatCount(data.viewings), period: true },
    { label: 'Giao dịch mới', value: formatCount(data.deals.new), period: true },
    { label: 'Giao dịch thành công', value: formatCount(data.deals.won), period: true },
    { label: 'Doanh thu', value: formatVnd(data.deals.revenue), period: true },
    { label: 'Nhân sự', value: formatCount(data.agents) },
  ];
  return (
    <div className="stats">
      {tiles.map((tile) => (
        <div key={tile.label} className="stat">
          <span className="stat-label">
            {tile.label}
            {tile.period && <span className="muted"> (trong kỳ)</span>}
          </span>
          <strong className="stat-value">{tile.value}</strong>
        </div>
      ))}
    </div>
  );
}

/**
 * Dashboard quản trị (TASK-102): số liệu tổng và phễu khách/giao dịch trong phạm vi `report.view` của
 * người xem. Kỳ chọn qua `?days=7|30|90`.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const days = periodDays((await searchParams)['days']);
  const dashboard = await fetchDashboard(await accessToken(), days);

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>Tổng quan</h1>
          {dashboard.ok && (
            <p className="muted">
              {SCOPE_LABELS[dashboard.data.scope] ?? dashboard.data.scope} · {days} ngày gần nhất
            </p>
          )}
        </div>
        <nav className="segmented" aria-label="Kỳ thống kê">
          {PERIOD_OPTIONS.map((option) => (
            <Link
              key={option}
              href={option === 30 ? '/' : `/?days=${option}`}
              aria-current={option === days ? 'page' : undefined}
            >
              {option} ngày
            </Link>
          ))}
        </nav>
      </div>

      {dashboard.ok ? (
        <>
          <Stats data={dashboard.data} />
          <div className="panels">
            <section className="card">
              <h2>Phễu khách hàng</h2>
              <Funnel
                rows={dashboard.data.leadFunnel.map((row) => ({
                  label: CUSTOMER_STATUS_LABELS[row.status] ?? row.status,
                  count: row.count,
                }))}
              />
            </section>
            <section className="card">
              <h2>Phễu giao dịch</h2>
              <Funnel
                rows={dashboard.data.salesFunnel.map((row) => ({
                  label: DEAL_STAGE_LABELS[row.stage] ?? row.stage,
                  count: row.count,
                  note: row.value > 0 ? formatVnd(row.value) : undefined,
                }))}
              />
            </section>
          </div>
        </>
      ) : (
        <div className="card">
          <p className="form-error" role="alert">
            {dashboard.status === 403 ? 'Bạn chưa có quyền xem báo cáo.' : dashboard.message}
          </p>
        </div>
      )}
    </main>
  );
}
