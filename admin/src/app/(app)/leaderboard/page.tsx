import Link from 'next/link';

import { accessToken } from '../../../lib/auth/server-session.ts';
import {
  formatCount,
  formatVnd,
  PERIOD_OPTIONS,
  periodDays,
  SCOPE_LABELS,
} from '../../../lib/dashboard.ts';
import {
  fetchLeaderboard,
  LEADERBOARD_SORTS,
  type LeaderboardSort,
  leaderboardHref,
  leaderboardSort,
  rankBy,
} from '../../../lib/leaderboard.ts';

/** Luôn render lúc request vì nội dung phụ thuộc người đăng nhập. */
export const dynamic = 'force-dynamic';

/**
 * Bảng xếp hạng môi giới (TASK-151): Top môi giới (điểm), doanh số, tin đăng, giao dịch trong phạm vi `report.view`.
 * Chọn bảng qua `?by=`, kỳ qua `?days=7|30|90`.
 */
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const days = periodDays(params['days']);
  const sort = leaderboardSort(params['by']);
  const result = await fetchLeaderboard(await accessToken(), days);

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>Xếp hạng</h1>
          {result.ok && (
            <p className="muted">
              {SCOPE_LABELS[result.data.scope] ?? result.data.scope} · {days} ngày gần nhất
            </p>
          )}
        </div>
        <nav className="segmented" aria-label="Kỳ thống kê">
          {PERIOD_OPTIONS.map((option) => (
            <Link
              key={option}
              href={leaderboardHref(sort, option)}
              aria-current={option === days ? 'page' : undefined}
            >
              {option} ngày
            </Link>
          ))}
        </nav>
      </div>

      <nav className="segmented" aria-label="Bảng xếp hạng">
        {(Object.keys(LEADERBOARD_SORTS) as LeaderboardSort[]).map((option) => (
          <Link
            key={option}
            href={leaderboardHref(option, days)}
            aria-current={option === sort ? 'page' : undefined}
          >
            {LEADERBOARD_SORTS[option]}
          </Link>
        ))}
      </nav>

      {result.ok ? (
        <section className="card">
          {result.data.agents.length === 0 ? (
            <p className="muted">Chưa có môi giới nào trong phạm vi xem.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Hạng</th>
                    <th scope="col">Môi giới</th>
                    <th scope="col">Điểm</th>
                    <th scope="col">Tin đăng</th>
                    <th scope="col">Chăm sóc</th>
                    <th scope="col">Dẫn khách</th>
                    <th scope="col">Giao dịch chốt</th>
                    <th scope="col">Doanh số</th>
                  </tr>
                </thead>
                <tbody>
                  {rankBy(result.data.agents, sort).map((agent) => (
                    <tr key={agent.userId}>
                      <td>{agent.rank}</td>
                      <td>{agent.fullName}</td>
                      <td>{formatCount(agent.points)}</td>
                      <td>{formatCount(agent.listings)}</td>
                      <td>{formatCount(agent.careDays)}</td>
                      <td>{formatCount(agent.viewings)}</td>
                      <td>{formatCount(agent.dealsWon)}</td>
                      <td>{formatVnd(agent.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted">
            Điểm: mỗi tin đăng mới {result.data.points.listing}, mỗi khách được chăm sóc trong ngày{' '}
            {result.data.points.care}, mỗi buổi dẫn khách hoàn thành {result.data.points.viewing},
            mỗi giao dịch chốt {result.data.points.dealWon}. Chỉ tính số liệu trong kỳ.
          </p>
        </section>
      ) : (
        <div className="card">
          <p className="form-error" role="alert">
            {result.status === 403 ? 'Bạn chưa có quyền xem báo cáo.' : result.message}
          </p>
        </div>
      )}
    </main>
  );
}
