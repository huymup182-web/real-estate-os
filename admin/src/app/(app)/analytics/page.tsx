import Link from 'next/link';

import {
  ANALYTICS_MONTHS,
  ANALYTICS_TABS,
  analyticsHref,
  analyticsMonths,
  analyticsTab,
  type AnalyticsTab,
  changePercent,
  type ConversionAnalytics,
  type ConversionGroup,
  CONVERSION_STEP_LABELS,
  fetchConversion,
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
import { SOURCE_LABELS } from '../../../lib/customers.ts';
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

function percentOrNone(value: number | null): string {
  return value === null ? NONE : formatPercent(value);
}

function daysOrNone(value: number | null): string {
  return value === null ? NONE : formatDecimal(value);
}

function ConversionStats({ data }: { data: ConversionAnalytics }) {
  const [lead, contacted, , , won] = data.funnel;
  const tiles = [
    { label: 'Lead mới', value: formatCount(lead?.count ?? 0) },
    {
      label: 'Tỷ lệ chốt',
      value: percentOrNone(won?.rateFromLead ?? null),
      note: `${formatCount(won?.count ?? 0)} khách chốt thành công`,
    },
    { label: 'Liên hệ được', value: percentOrNone(contacted?.rateFromLead ?? null) },
    {
      label: 'Ngày tới lần liên hệ đầu',
      value: daysOrNone(data.medianDaysToContact),
      note: 'Giữa các khách đã liên hệ',
    },
    {
      label: 'Ngày để chốt',
      value: daysOrNone(data.medianDaysToWin),
      note: 'Từ lúc tạo khách',
    },
    { label: 'Thất bại', value: formatCount(data.lost) },
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

function ConversionFunnel({ data }: { data: ConversionAnalytics }) {
  const widths = barWidths(data.funnel.map((step) => step.count));
  return (
    <ul className="funnel">
      {data.funnel.map((step, index) => (
        <li key={step.step}>
          <span className="funnel-label">{CONVERSION_STEP_LABELS[step.step] ?? step.step}</span>
          <span className="funnel-track">
            <span className="funnel-bar" style={{ width: `${widths[index]}%` }} />
          </span>
          <span className="funnel-value">
            {formatCount(step.count)}
            {step.rateFromPrevious !== null && (
              <span className="muted"> · {formatPercent(step.rateFromPrevious)} bước trước</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ConversionTable({
  title,
  column,
  rows,
}: {
  title: string;
  column: string;
  rows: { label: string; group: ConversionGroup }[];
}) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="muted">Chưa có lead nào trong kỳ.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{column}</th>
                <th scope="col">Lead</th>
                <th scope="col">Đã liên hệ</th>
                <th scope="col">Chốt</th>
                <th scope="col">Tỷ lệ chốt</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ label, group }) => (
                <tr key={group.key ?? 'none'}>
                  <td>{label}</td>
                  <td>{formatCount(group.leads)}</td>
                  <td>{formatCount(group.contacted)}</td>
                  <td>{formatCount(group.won)}</td>
                  <td>{percentOrNone(group.conversionRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

async function ConversionView({ token, months }: { token: string; months: number }) {
  const result = await fetchConversion(token, months);
  if (!result.ok) {
    return <ErrorCard status={result.status} message={result.message} />;
  }
  const { data } = result;
  return (
    <>
      <p className="muted">
        {SCOPE_LABELS[data.scope] ?? data.scope} · Khách tạo trong {months} tháng gần nhất, tính tới
        hiện tại
      </p>
      <ConversionStats data={data} />
      <div className="panels">
        <section className="card">
          <h2>Phễu chuyển đổi</h2>
          <ConversionFunnel data={data} />
        </section>
        <ConversionTable
          title="Theo nguồn khách"
          column="Nguồn"
          rows={data.bySource
            .filter((group) => group.leads > 0)
            .map((group) => ({
              label:
                group.key === null ? 'Chưa ghi nguồn' : (SOURCE_LABELS[group.key] ?? group.key),
              group,
            }))}
        />
      </div>
      <ConversionTable
        title="Theo người phụ trách"
        column="Môi giới"
        rows={data.byAgent.map((group) => ({ label: group.name ?? 'Chưa giao', group }))}
      />
    </>
  );
}

function ErrorCard({ status, message }: { status: number; message: string }) {
  return (
    <div className="card">
      <p className="form-error" role="alert">
        {status === 403 ? 'Bạn chưa có quyền xem báo cáo.' : message}
      </p>
    </div>
  );
}

async function SalesView({ token, months }: { token: string; months: number }) {
  const sales = await fetchSales(token, months);
  if (!sales.ok) {
    return <ErrorCard status={sales.status} message={sales.message} />;
  }
  return (
    <>
      <p className="muted">
        {SCOPE_LABELS[sales.data.scope] ?? sales.data.scope} · Giao dịch chốt trong {months} tháng
        gần nhất
      </p>
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
  );
}

/**
 * Phân tích (TASK-152, TASK-153): tab Doanh số (doanh số so với kỳ trước, tỷ lệ thắng, thời gian chốt, xu hướng
 * theo tháng, giao dịch đang mở, theo loại BĐS và khu vực) và tab Chuyển đổi (phễu khách tạo trong kỳ, theo nguồn
 * và người phụ trách). Chỉ tính dữ liệu trong phạm vi `report.view`. Chọn qua `?tab=sales|conversion&months=3|6|12`.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const months = analyticsMonths(params['months']);
  const tab = analyticsTab(params['tab']);
  const token = await accessToken();

  return (
    <main className="page">
      <div className="page-heading">
        <h1>Phân tích</h1>
        <nav className="segmented" aria-label="Kỳ thống kê">
          {ANALYTICS_MONTHS.map((option) => (
            <Link
              key={option}
              href={analyticsHref(tab, option)}
              aria-current={option === months ? 'page' : undefined}
            >
              {option} tháng
            </Link>
          ))}
        </nav>
      </div>
      <nav className="segmented" aria-label="Loại phân tích">
        {(Object.keys(ANALYTICS_TABS) as AnalyticsTab[]).map((option) => (
          <Link
            key={option}
            href={analyticsHref(option, months)}
            aria-current={option === tab ? 'page' : undefined}
          >
            {ANALYTICS_TABS[option]}
          </Link>
        ))}
      </nav>
      {tab === 'sales' ? (
        <SalesView token={token} months={months} />
      ) : (
        <ConversionView token={token} months={months} />
      )}
    </main>
  );
}
