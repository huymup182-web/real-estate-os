import Link from 'next/link';

import { accessToken } from '../../../../lib/auth/server-session.ts';
import { getPermissionCatalog } from '../../../../lib/roles.ts';
import { createRoleAction } from '../actions.ts';
import { RoleForm } from '../role-form.tsx';

export const dynamic = 'force-dynamic';

/** Tạo vai trò (TASK-104). Không có `admin.manage` thì backend trả 403. */
export default async function NewRolePage() {
  const catalog = await getPermissionCatalog(await accessToken());
  return (
    <main className="page">
      <p>
        <Link href="/roles">← Vai trò</Link>
      </p>
      <h1>Thêm vai trò</h1>
      <div className="card">
        {catalog.ok ? (
          <RoleForm
            action={createRoleAction}
            catalog={catalog.data}
            initial={{ code: '', name: '', description: '', scopes: {} }}
            withCode
            permissionsLocked={false}
            submitLabel="Tạo vai trò"
          />
        ) : (
          <p className="form-error" role="alert">
            {catalog.status === 403 ? 'Bạn chưa có quyền quản lý vai trò.' : catalog.message}
          </p>
        )}
      </div>
    </main>
  );
}
