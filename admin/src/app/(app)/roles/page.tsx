import Link from 'next/link';

import { accessToken } from '../../../lib/auth/server-session.ts';
import { listRoles } from '../../../lib/roles.ts';

export const dynamic = 'force-dynamic';

/** Danh sách vai trò của công ty (TASK-104), cần `admin.manage`. */
export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { saved } = await searchParams;
  const roles = await listRoles(await accessToken());

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>Vai trò</h1>
          {roles.ok && <p className="muted">{roles.data.length} vai trò</p>}
        </div>
        {roles.ok && (
          <Link href="/roles/new" className="button">
            Thêm vai trò
          </Link>
        )}
      </div>
      {saved === 'deleted' && (
        <p className="form-success" role="status">
          Đã xoá vai trò.
        </p>
      )}

      {!roles.ok ? (
        <div className="card">
          <p className="form-error" role="alert">
            {roles.status === 403 ? 'Bạn chưa có quyền quản lý vai trò.' : roles.message}
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tên</th>
                <th>Mã</th>
                <th>Mô tả</th>
                <th>Người dùng</th>
                <th>Quyền</th>
              </tr>
            </thead>
            <tbody>
              {roles.data.map((role) => (
                <tr key={role.id}>
                  <td>
                    <Link href={`/roles/${role.id}`}>{role.name}</Link>{' '}
                    {role.isSystem && <span className="badge">Mặc định</span>}
                  </td>
                  <td>
                    <code>{role.code}</code>
                  </td>
                  <td>{role.description ?? <span className="muted">—</span>}</td>
                  <td>{role.userCount}</td>
                  <td>{role.permissionCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
