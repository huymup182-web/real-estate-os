import Link from 'next/link';
import { notFound } from 'next/navigation';

import { currentUser } from '../../../../lib/auth/auth-api.ts';
import { hasPermission } from '../../../../lib/auth/permissions.ts';
import { accessToken } from '../../../../lib/auth/server-session.ts';
import { getUser, getUserOptions, USER_STATUS_LABELS } from '../../../../lib/users.ts';
import { changeStatusAction, updateUserAction } from '../actions.ts';
import { StatusActions } from '../status-actions.tsx';
import { UserForm } from '../user-form.tsx';

export const dynamic = 'force-dynamic';

const SAVED_MESSAGES: Record<string, string> = {
  created: 'Đã tạo người dùng.',
  updated: 'Đã lưu thay đổi.',
  status: 'Đã đổi trạng thái tài khoản.',
};

/** Chi tiết và sửa người dùng (TASK-103). */
export default async function UserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;
  const token = await accessToken();
  const [me, user] = await Promise.all([currentUser(token), getUser(token, id)]);
  if (!user.ok && (user.status === 404 || user.status === 400)) {
    notFound();
  }
  const canManage = me.ok && hasPermission(me.data, 'user.manage');
  const options = canManage ? await getUserOptions(token) : null;
  const isSelf = me.ok && user.ok && me.data.user.id === user.data.id;

  return (
    <main className="page">
      <p>
        <Link href="/users">← Người dùng</Link>
      </p>
      {!user.ok ? (
        <div className="card">
          <p className="form-error" role="alert">
            {user.status === 403 ? 'Bạn chưa có quyền xem người dùng.' : user.message}
          </p>
        </div>
      ) : (
        <>
          <div className="page-heading">
            <div>
              <h1>{user.data.fullName}</h1>
              <span className={`badge badge-${user.data.status.toLowerCase()}`}>
                {USER_STATUS_LABELS[user.data.status]}
              </span>
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
                <h2>Thông tin</h2>
                <UserForm
                  action={updateUserAction.bind(null, user.data.id)}
                  options={options.data}
                  initial={{
                    fullName: user.data.fullName,
                    email: user.data.email ?? '',
                    phone: user.data.phone ?? '',
                    departmentId: user.data.department?.id ?? '',
                    roleIds: user.data.roles.map((role) => role.id),
                  }}
                  withPassword={false}
                  submitLabel="Lưu thay đổi"
                />
              </section>
              {!isSelf && (
                <section className="card">
                  <h2>Trạng thái tài khoản</h2>
                  <p className="muted">
                    Tài khoản không ở trạng thái hoạt động sẽ bị đăng xuất ngay và không đăng nhập
                    được.
                  </p>
                  <StatusActions
                    action={changeStatusAction.bind(null, user.data.id)}
                    status={user.data.status}
                  />
                </section>
              )}
            </>
          ) : (
            <section className="card">
              <dl className="details">
                <dt>Email</dt>
                <dd>{user.data.email ?? '—'}</dd>
                <dt>Số điện thoại</dt>
                <dd>{user.data.phone ?? '—'}</dd>
                <dt>Phòng ban</dt>
                <dd>{user.data.department?.name ?? '—'}</dd>
                <dt>Vai trò</dt>
                <dd>{user.data.roles.map((role) => role.name).join(', ')}</dd>
              </dl>
            </section>
          )}
        </>
      )}
    </main>
  );
}
