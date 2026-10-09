import Link from 'next/link';
import { notFound } from 'next/navigation';

import { accessToken } from '../../../../lib/auth/server-session.ts';
import { getPermissionCatalog, getRole, roleFormValues } from '../../../../lib/roles.ts';
import { deleteRoleAction, updateRoleAction } from '../actions.ts';
import { DeleteRole } from '../delete-role.tsx';
import { RoleForm } from '../role-form.tsx';

export const dynamic = 'force-dynamic';

const SAVED_MESSAGES: Record<string, string> = {
  created: 'Đã tạo vai trò.',
  updated: 'Đã lưu thay đổi. Quyền mới có hiệu lực ngay với người dùng thuộc vai trò này.',
};

/** Chi tiết và sửa vai trò (TASK-104). */
export default async function RolePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;
  const token = await accessToken();
  const [role, catalog] = await Promise.all([getRole(token, id), getPermissionCatalog(token)]);
  if (!role.ok && (role.status === 404 || role.status === 400)) {
    notFound();
  }
  const failure = !role.ok ? role : !catalog.ok ? catalog : null;

  return (
    <main className="page">
      <p>
        <Link href="/roles">← Vai trò</Link>
      </p>
      {failure || !role.ok || !catalog.ok ? (
        <div className="card">
          <p className="form-error" role="alert">
            {failure?.status === 403 ? 'Bạn chưa có quyền quản lý vai trò.' : failure?.message}
          </p>
        </div>
      ) : (
        <>
          <div className="page-heading">
            <div>
              <h1>{role.data.name}</h1>
              <p className="muted">
                <code>{role.data.code}</code> · {role.data.userCount} người dùng
                {role.data.isSystem && ' · Vai trò mặc định'}
              </p>
            </div>
          </div>
          {typeof saved === 'string' && SAVED_MESSAGES[saved] && (
            <p className="form-success" role="status">
              {SAVED_MESSAGES[saved]}
            </p>
          )}
          <section className="card">
            <RoleForm
              action={updateRoleAction.bind(null, role.data.id, role.data.permissionsLocked)}
              catalog={catalog.data}
              initial={roleFormValues(role.data)}
              withCode={false}
              permissionsLocked={role.data.permissionsLocked}
              submitLabel="Lưu thay đổi"
            />
          </section>
          {!role.data.isSystem && (
            <section className="card">
              <h2>Xoá vai trò</h2>
              <p className="muted">Chỉ xoá được khi không còn người dùng nào giữ vai trò này.</p>
              <DeleteRole
                action={deleteRoleAction.bind(null, role.data.id)}
                name={role.data.name}
              />
            </section>
          )}
        </>
      )}
    </main>
  );
}
