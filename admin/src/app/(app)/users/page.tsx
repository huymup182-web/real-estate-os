import Link from 'next/link';

import { currentUser } from '../../../lib/auth/auth-api.ts';
import { hasPermission } from '../../../lib/auth/permissions.ts';
import { accessToken } from '../../../lib/auth/server-session.ts';
import {
  filterQuery,
  getUserOptions,
  listUsers,
  USER_STATUS_LABELS,
  USER_STATUSES,
  userFilters,
  type UserFormOptions,
} from '../../../lib/users.ts';

export const dynamic = 'force-dynamic';

const dateFormat = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
});

/** Danh sách người dùng trong phạm vi `user.view` (TASK-103), lọc qua query của trang. */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = await accessToken();
  const filters = userFilters(await searchParams);
  const [me, users] = await Promise.all([currentUser(token), listUsers(token, filters)]);
  const canManage = me.ok && hasPermission(me.data, 'user.manage');
  const options: UserFormOptions | null = canManage
    ? await getUserOptions(token).then((result) => (result.ok ? result.data : null))
    : null;

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>Người dùng</h1>
          {users.ok && <p className="muted">{users.meta?.total ?? users.data.length} người</p>}
        </div>
        {canManage && (
          <Link href="/users/new" className="button">
            Thêm người dùng
          </Link>
        )}
      </div>

      <form className="filters" role="search">
        <input
          name="q"
          type="search"
          defaultValue={filters.q}
          placeholder="Tên, email hoặc số điện thoại"
          aria-label="Tìm người dùng"
        />
        <select name="status" defaultValue={filters.status} aria-label="Trạng thái">
          <option value="">Mọi trạng thái</option>
          {USER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {USER_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        {options && (
          <>
            <select name="roleId" defaultValue={filters.roleId} aria-label="Vai trò">
              <option value="">Mọi vai trò</option>
              {options.roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
            <select name="departmentId" defaultValue={filters.departmentId} aria-label="Phòng ban">
              <option value="">Mọi phòng ban</option>
              {options.departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </>
        )}
        <button type="submit" className="button button-secondary">
          Lọc
        </button>
      </form>

      {!users.ok ? (
        <div className="card">
          <p className="form-error" role="alert">
            {users.status === 403 ? 'Bạn chưa có quyền xem người dùng.' : users.message}
          </p>
        </div>
      ) : users.data.length === 0 ? (
        <div className="card">
          <p className="muted">Không có người dùng nào khớp bộ lọc.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Họ tên</th>
                <th>Liên hệ</th>
                <th>Phòng ban</th>
                <th>Vai trò</th>
                <th>Trạng thái</th>
                <th>Đăng nhập gần nhất</th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((user) => (
                <tr key={user.id}>
                  <td>
                    <Link href={`/users/${user.id}`}>{user.fullName}</Link>
                  </td>
                  <td>
                    {user.email && <div>{user.email}</div>}
                    {user.phone && <div className="muted">{user.phone}</div>}
                  </td>
                  <td>{user.department?.name ?? <span className="muted">—</span>}</td>
                  <td>{user.roles.map((role) => role.name).join(', ')}</td>
                  <td>
                    <span className={`badge badge-${user.status.toLowerCase()}`}>
                      {USER_STATUS_LABELS[user.status]}
                    </span>
                  </td>
                  <td>
                    {user.lastLoginAt ? (
                      dateFormat.format(new Date(user.lastLoginAt))
                    ) : (
                      <span className="muted">Chưa đăng nhập</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {users.ok && users.meta && users.meta.totalPages > 1 && (
        <nav className="pager" aria-label="Phân trang">
          {filters.page > 1 ? (
            <Link href={`/users${filterQuery(filters, filters.page - 1)}`}>← Trước</Link>
          ) : (
            <span />
          )}
          <span className="muted">
            Trang {users.meta.page}/{users.meta.totalPages}
          </span>
          {filters.page < users.meta.totalPages ? (
            <Link href={`/users${filterQuery(filters, filters.page + 1)}`}>Sau →</Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
