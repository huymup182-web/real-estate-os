import Link from 'next/link';

import {
  ANALYTICS_MONTHS,
  analyticsMonths,
  changePercent,
  fetchSales,
  type SalesAnalytics,
  type SalesGroup,
} from '../../../lib/analytics.ts';
import { accessToken } from '../../../lib/auth/server-session.ts';
import {
  barWidths,
  DEAL_STAGE_LABELS,
  formatCount,
  formatVnd,
  SCOPE_LABELS,
} from '../../../lib/dashboard.ts';
import { formatChange, formatDecimal, formatMonth, formatPercent } from '../../../lib/market.ts';
import { PROPERTY_TYPE_LABELS } from '../../../lib/properties.ts';

/** Luôn render lúc request vì nội dung phụ thuộc người đăng nhập. */
export const dynamic = 'force-dynamic';

const NONE = '—';

function Stats({ data }: { data: SalesAnalytics }) {
  const { summary } = data;
  const change = changePercent(summary.revenue, data.previous.revenue);
  const pipelineValue = data.pipeline.reduce((total, stage) => total + stage.value, 0);
  const tiles = [
    {
      label: 'Doanh số',
      value: formatVnd(summary.revenue),
      note: change === null ? undefined : `${formatChange(change)} so với kỳ trước`,
    },
    { label: 'Giao dịch chốt', value: formatCount(summary.wonCount) },
    {
      label: 'Giá trị trung bình',
      value: summary.avgDealValue === null ? NONE : formatVnd(summary.avgDealValue),
    },
    {
      label: 'Tỷ lệ thắng',
      value: summary.winRate === null ? NONE : formatPercent(summary.winRate),
      note: `${formatCount(summary.wonCount)} thắng, ${formatCount(summary.lostCount)} thua`,
    },
    {
      label: 'Ngày để chốt',
      value: summary.medianDaysToClose === null ? NONE : formatDecimal(summary.medianDaysToClose),
      note: 'Giữa các giao dịch thắng',
    },
    { label: 'Đang đàm phán', value: formatVnd(pipelineValue), note: 'Giao dịch chưa chốt' },
  ];
  return (
    <div className="stats">
      {tiles.map((tile) => (
        <div key={tile.label} className="stat">
          <span className="stat-label">{tile.label}</span>
          <strong className="stat-value">{tile.value}</strong>
          {tile.note && <span className="muted">{tile.note}</span>}
        </div>
      ))}
    </div>
  );
}

function Bars({ rows }: { rows: { key: string; label: string; value: number; note: string }[] }) {
  const widths = barWidths(rows.map((row) => row.value));
  return (
    <ul className="funnel">
      {rows.map((row, index) => (
        <li key={row.key} title={`${row.label}: ${formatVnd(row.value)}, ${row.note}`}>
          <span className="funnel-label">{row.label}</span>
          <span className="funnel-track">
            <span className="funnel-bar" style={{ width: `${widths[index]}%` }} />
          </span>
          <span className="funnel-value">
            {formatVnd(row.value)}
            <span className="muted"> · {row.note}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function GroupTable({
  title,
  column,
  rows,
}: {
  title: string;
  column: string;
  rows: { label: string; group: SalesGroup }[];
}) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="muted">Chưa có giao dịch chốt trong kỳ.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{column}</th>
                <th scope="col">Giao dịch chốt</th>
                <th scope="col">Doanh số</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ label, group }) => (
                <tr key={group.key}>
                  <td>{label}</td>
                  <td>{formatCount(group.wonCount)}</td>
                  <td>{formatVnd(group.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Phân tích doanh số (TASK-152): doanh số so với kỳ trước, tỷ lệ thắng, thời gian chốt, xu hướng theo tháng, giao
 * dịch đang mở, theo loại BĐS và khu vực. Chỉ tính giao dịch trong phạm vi `report.view`. Kỳ qua `?months=3|6|12`.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const months = analyticsMonths((await searchParams)['months']);
  const sales = await fetchSales(await accessToken(), months);

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>Phân tích doanh số</h1>
          {sales.ok && (
            <p className="muted">
              {SCOPE_LABELS[sales.data.scope] ?? sales.data.scope} · {months} tháng gần nhất
            </p>
          )}
        </div>
        <nav className="segmented" aria-label="Kỳ thống kê">
          {ANALYTICS_MONTHS.map((option) => (
            <Link
              key={option}
              href={option === 6 ? '/analytics' : `/analytics?months=${option}`}
              aria-current={option === months ? 'page' : undefined}
            >
              {option} tháng
            </Link>
          ))}
        </nav>
      </div>

      {sales.ok ? (
        <>
          <Stats data={sales.data} />
          <div className="panels">
            <section className="card">
              <h2>Doanh số theo tháng</h2>
              <Bars
                rows={sales.data.trend.map((month) => ({
                  key: month.month,
                  label: formatMonth(month.month),
                  value: month.revenue,
                  note: `${formatCount(month.wonCount)} giao dịch`,
                }))}
              />
            </section>
            <section className="card">
              <h2>Giao dịch đang mở</h2>
              <Bars
                rows={sales.data.pipeline.map((stage) => ({
                  key: stage.stage,
                  label: DEAL_STAGE_LABELS[stage.stage] ?? stage.stage,
                  value: stage.value,
                  note: `${formatCount(stage.count)} giao dịch`,
                }))}
              />
            </section>
          </div>
          <div className="panels">
            <GroupTable
              title="Theo loại BĐS"
              column="Loại BĐS"
              rows={sales.data.byPropertyType.map((group) => ({
                label:
                  PROPERTY_TYPE_LABELS[group.key as keyof typeof PROPERTY_TYPE_LABELS] ?? group.key,
                group,
              }))}
            />
            <GroupTable
              title="Theo khu vực"
              column="Phường/xã"
              rows={sales.data.byWard.map((group) => ({ label: group.name ?? group.key, group }))}
            />
          </div>
        </>
      ) : (
        <div className="card">
          <p className="form-error" role="alert">
            {sales.status === 403 ? 'Bạn chưa có quyền xem báo cáo.' : sales.message}
          </p>
        </div>
      )}
    </main>
  );
}
