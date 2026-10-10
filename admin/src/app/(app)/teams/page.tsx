import Link from 'next/link';

import { currentUser } from '../../../lib/auth/auth-api.ts';
import { hasPermission } from '../../../lib/auth/permissions.ts';
import { accessToken } from '../../../lib/auth/server-session.ts';
import { listTeams } from '../../../lib/teams.ts';

export const dynamic = 'force-dynamic';

/** Danh sách team trong phạm vi `team.view` (TASK-106). */
export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { saved } = await searchParams;
  const token = await accessToken();
  const [me, teams] = await Promise.all([currentUser(token), listTeams(token)]);
  const canManage = me.ok && hasPermission(me.data, 'team.manage');

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>Team</h1>
          {teams.ok && <p className="muted">{teams.data.length} team</p>}
        </div>
        {canManage && (
          <Link href="/teams/new" className="button">
            Thêm team
          </Link>
        )}
      </div>
      {saved === 'deleted' && (
        <p className="form-success" role="status">
          Đã xoá team.
        </p>
      )}

      {!teams.ok ? (
        <div className="card">
          <p className="form-error" role="alert">
            {teams.status === 403 ? 'Bạn chưa có quyền xem team.' : teams.message}
          </p>
        </div>
      ) : teams.data.length === 0 ? (
        <div className="card">
          <p className="muted">Chưa có team nào.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tên</th>
                <th>Phòng ban</th>
                <th>Trưởng nhóm</th>
                <th>Thành viên</th>
              </tr>
            </thead>
            <tbody>
              {teams.data.map((team) => (
                <tr key={team.id}>
                  <td>
                    <Link href={`/teams/${team.id}`}>{team.name}</Link>
                  </td>
                  <td>{team.department.name}</td>
                  <td>{team.leader?.fullName ?? <span className="muted">—</span>}</td>
                  <td>{team.memberCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
