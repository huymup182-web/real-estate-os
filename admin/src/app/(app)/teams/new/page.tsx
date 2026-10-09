import Link from 'next/link';

import { accessToken } from '../../../../lib/auth/server-session.ts';
import { getTeamOptions } from '../../../../lib/teams.ts';
import { createTeamAction } from '../actions.ts';
import { TeamForm } from '../team-form.tsx';

export const dynamic = 'force-dynamic';

/** Tạo team (TASK-106). Không có `team.manage` thì backend trả 403. */
export default async function NewTeamPage() {
  const options = await getTeamOptions(await accessToken());
  return (
    <main className="page">
      <p>
        <Link href="/teams">← Team</Link>
      </p>
      <h1>Thêm team</h1>
      <div className="card">
        {!options.ok ? (
          <p className="form-error" role="alert">
            {options.status === 403 ? 'Bạn chưa có quyền tạo team.' : options.message}
          </p>
        ) : options.data.departments.length === 0 ? (
          <p className="muted">
            Chưa có phòng ban nào bạn tạo team được. Phòng ban được thêm ở trang Công ty.
          </p>
        ) : (
          <TeamForm
            action={createTeamAction}
            options={options.data}
            initial={{
              name: '',
              departmentId:
                options.data.departments.length === 1
                  ? (options.data.departments[0]?.id ?? '')
                  : '',
              leaderId: '',
              memberIds: [],
            }}
            currentMembers={[]}
            submitLabel="Tạo team"
          />
        )}
      </div>
    </main>
  );
}
