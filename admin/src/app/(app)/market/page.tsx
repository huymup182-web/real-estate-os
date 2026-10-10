import Link from 'next/link';

import { accessToken } from '../../../lib/auth/server-session.ts';
import { barWidths, formatCount, formatVnd } from '../../../lib/dashboard.ts';
import {
  type AreaRow,
  areaRows,
  fetchMarket,
  formatChange,
  formatDecimal,
  formatMonth,
  formatPercent,
  LIQUIDITY_LABELS,
  MARKET_GROUP_LABELS,
  type MarketData,
  marketFilters,
  type MarketFilters,
  marketQuery,
  MONTH_OPTIONS,
  trendChange,
} from '../../../lib/market.ts';
import { getProvinces, PROPERTY_TYPE_LABELS } from '../../../lib/properties.ts';

/** Luôn render lúc request vì nội dung phụ thuộc người đăng nhập. */
export const dynamic = 'force-dynamic';

const NONE = '—';

function show(value: number | null | undefined, format: (value: number) => string): string {
  return value === null || value === undefined ? NONE : format(value);
}

function vnd(value: number | null | undefined): string {
  return value === null || value === undefined ? NONE : formatVnd(value);
}

function perM2(value: number | null | undefined): string {
  return value === null || value === undefined ? NONE : `${formatVnd(value)}/m²`;
}

function Level({ level }: { level: string | null | undefined }) {
  if (!level) {
    return <span className="muted">{NONE}</span>;
  }
  return (
    <span className={`badge badge-liquidity-${level.toLowerCase()}`}>
      {LIQUIDITY_LABELS[level] ?? level}
    </span>
  );
}

function Stats({ data }: { data: MarketData }) {
  const change = trendChange(data.perM2.trend);
  const liquidity = data.liquidity.overall;
  const tiles = [
    { label: 'Tin tính giá', value: formatCount(data.prices.overall.count) },
    { label: 'Giá giữa', value: vnd(data.prices.overall.medianPrice) },
    { label: 'Giá/m² giữa', value: perM2(data.perM2.overall.medianPricePerM2) },
    { label: 'Xu hướng giá/m²', value: change === null ? NONE : formatChange(change) },
    { label: 'Đang bán', value: formatCount(liquidity.supply) },
    { label: 'Đã bán trong kỳ', value: formatCount(liquidity.sold) },
    {
      label: 'Tỷ lệ bán',
      value: liquidity.sellThroughRate === null ? NONE : formatPercent(liquidity.sellThroughRate),
      level: liquidity.level,
    },
    {
      label: 'Số ngày bán (giữa)',
      value: liquidity.medianDaysToSell === null ? NONE : `${liquidity.medianDaysToSell} ngày`,
    },
  ];
  return (
    <div className="stats">
      {tiles.map((tile) => (
        <div key={tile.label} className="stat">
          <span className="stat-label">{tile.label}</span>
          <strong className="stat-value">{tile.value}</strong>
          {tile.level && <Level level={tile.level} />}
        </div>
      ))}
    </div>
  );
}

function Trend({ trend }: { trend: MarketData['perM2']['trend'] }) {
  const widths = barWidths(trend.map((month) => month.medianPricePerM2 ?? 0));
  return (
    <ul className="funnel">
      {trend.map((month, index) => {
        const value = perM2(month.medianPricePerM2);
        return (
          <li key={month.month} title={`${formatMonth(month.month)}: ${value}, ${month.count} tin`}>
            <span className="funnel-label">{formatMonth(month.month)}</span>
            <span className="funnel-track">
              <span className="funnel-bar" style={{ width: `${widths[index]}%` }} />
            </span>
            <span className="funnel-value">
              {value}
              <span className="muted"> · {formatCount(month.count)} tin</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Ranking({ rows, groupBy }: { rows: AreaRow[]; groupBy: MarketFilters['groupBy'] }) {
  if (rows.length === 0) {
    return <p className="muted">Chưa có tin đăng nào trong kỳ.</p>;
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{groupBy === 'ward' ? 'Phường/xã' : 'Loại BĐS'}</th>
            <th>Tin tính giá</th>
            <th>Giá giữa</th>
            <th>Giá/m² giữa</th>
            <th>Đang bán</th>
            <th>Đã bán</th>
            <th>Tỷ lệ bán</th>
            <th>Thanh khoản</th>
            <th>Ngày bán (giữa)</th>
            <th>Lượt xem/tin</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td>{formatCount(row.prices?.count ?? 0)}</td>
              <td>{vnd(row.prices?.medianPrice)}</td>
              <td>{perM2(row.perM2?.medianPricePerM2)}</td>
              <td>{formatCount(row.liquidity?.supply ?? 0)}</td>
              <td>{formatCount(row.liquidity?.sold ?? 0)}</td>
              <td>{show(row.liquidity?.sellThroughRate, formatPercent)}</td>
              <td>
                <Level level={row.liquidity?.level} />
              </td>
              <td>{show(row.liquidity?.medianDaysToSell, (days) => `${days} ngày`)}</td>
              <td>{show(row.liquidity?.viewsPerListing, formatDecimal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Thị trường (TASK-148, MASTER_PLAN mục 21): giá, giá/m² và xu hướng theo tháng, cung, đã bán, thanh khoản,
 * xếp hạng khu vực. Số liệu chỉ tính BĐS trong phạm vi `property.view` của người xem (TASK-145–147).
 */
export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = marketFilters(await searchParams);
  const token = await accessToken();
  const [market, provinces] = await Promise.all([fetchMarket(token, filters), getProvinces(token)]);

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>Thị trường</h1>
          <p className="muted">
            Tin đang bán, đang giao dịch, đã bán · {filters.months} tháng gần nhất
          </p>
        </div>
        <nav className="segmented" aria-label="Kỳ thống kê">
          {MONTH_OPTIONS.map((months) => (
            <Link
              key={months}
              href={`/market${marketQuery({ ...filters, months })}`}
              aria-current={months === filters.months ? 'page' : undefined}
            >
              {months} tháng
            </Link>
          ))}
        </nav>
      </div>

      <form className="filters" aria-label="Lọc thị trường">
        {provinces.ok && (
          <select name="provinceId" defaultValue={filters.provinceId} aria-label="Tỉnh/thành">
            <option value="">Mọi tỉnh/thành</option>
            {provinces.data.map((province) => (
              <option key={province.id} value={province.id}>
                {province.name}
              </option>
            ))}
          </select>
        )}
        <select name="propertyType" defaultValue={filters.propertyType} aria-label="Loại BĐS">
          <option value="">Mọi loại</option>
          {Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select name="groupBy" defaultValue={filters.groupBy} aria-label="Chia nhóm">
          {Object.entries(MARKET_GROUP_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input type="hidden" name="months" value={filters.months} />
        <button type="submit" className="button button-secondary">
          Xem
        </button>
      </form>

      {market.ok ? (
        <>
          <Stats data={market.data} />
          <div className="panels">
            <section className="card">
              <h2>Giá/m² giữa theo tháng</h2>
              <Trend trend={market.data.perM2.trend} />
            </section>
          </div>
          <section>
            <h2>Xếp hạng khu vực</h2>
            <Ranking rows={areaRows(market.data, filters.groupBy)} groupBy={filters.groupBy} />
            <p className="muted">
              Nhóm dưới {market.data.prices.minSample} tin không hiện giá. Thanh khoản Cao khi tỷ lệ
              bán từ {market.data.liquidity.thresholds.high}%, Trung bình từ{' '}
              {market.data.liquidity.thresholds.medium}%.
            </p>
          </section>
        </>
      ) : (
        <div className="card">
          <p className="form-error" role="alert">
            {market.status === 403 ? 'Bạn chưa có quyền xem bất động sản.' : market.message}
          </p>
        </div>
      )}
    </main>
  );
}
