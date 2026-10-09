import Link from 'next/link';
import { notFound } from 'next/navigation';

import { accessToken } from '../../../../lib/auth/server-session.ts';
import { USER_STATUS_LABELS } from '../../../../lib/users.ts';
import { getTeam, getTeamOptions } from '../../../../lib/teams.ts';
import { DeleteButton } from '../../delete-button.tsx';
import { deleteTeamAction, updateTeamAction } from '../actions.ts';
import { TeamForm } from '../team-form.tsx';

export const dynamic = 'force-dynamic';

const SAVED_MESSAGES: Record<string, string> = {
  created: 'Đã tạo team.',
  updated: 'Đã lưu thay đổi.',
};

/** Chi tiết team (TASK-106): ai có quyền quản lý team này thì sửa, xoá được; còn lại chỉ xem. */
export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;
  const token = await accessToken();
  const team = await getTeam(token, id);
  if (!team.ok && (team.status === 404 || team.status === 400)) {
    notFound();
  }
  const options = team.ok && team.data.canManage ? await getTeamOptions(token) : null;

  return (
    <main className="page">
      <p>
        <Link href="/teams">← Team</Link>
      </p>
      {!team.ok ? (
        <div className="card">
          <p className="form-error" role="alert">
            {team.status === 403 ? 'Bạn chưa có quyền xem team.' : team.message}
          </p>
        </div>
      ) : (
        <>
          <div className="page-heading">
            <div>
              <h1>{team.data.name}</h1>
              <p className="muted">
                {team.data.department.name} · {team.data.memberCount} thành viên
              </p>
            </div>
          </div>
          {typeof saved === 'string' && SAVED_MESSAGES[saved] && (
            <p className="form-success" role="status">
              {SAVED_MESSAGES[saved]}
            </p>
          )}
          {options?.ok ? (
            <>
              <section className="card">
                <TeamForm
                  action={updateTeamAction.bind(null, team.data.id)}
                  options={options.data}
                  initial={{
                    name: team.data.name,
                    departmentId: team.data.department.id,
                    leaderId: team.data.leader?.id ?? '',
                    memberIds: team.data.members.map((member) => member.id),
                  }}
                  currentMembers={team.data.members}
                  submitLabel="Lưu thay đổi"
                />
              </section>
              <section className="card">
                <h2>Xoá team</h2>
                <p className="muted">
                  Thành viên không bị xoá; trưởng nhóm sẽ không còn thấy dữ liệu của họ qua team
                  này.
                </p>
                <DeleteButton
                  action={deleteTeamAction.bind(null, team.data.id)}
                  label="Xoá team"
                  confirmText={`Xoá team "${team.data.name}"?`}
                />
              </section>
            </>
          ) : (
            <section className="card">
              <dl className="details">
                <dt>Trưởng nhóm</dt>
                <dd>{team.data.leader?.fullName ?? '—'}</dd>
                <dt>Thành viên</dt>
                <dd>
                  {team.data.members.length === 0
                    ? '—'
                    : team.data.members
                        .map((member) =>
                          member.status === 'ACTIVE'
                            ? member.fullName
                            : `${member.fullName} (${USER_STATUS_LABELS[member.status]})`,
                        )
                        .join(', ')}
                </dd>
              </dl>
            </section>
          )}
        </>
      )}
    </main>
  );
}
