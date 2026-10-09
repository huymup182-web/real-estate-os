import Link from 'next/link';
import { notFound } from 'next/navigation';

import { accessToken } from '../../../../../lib/auth/server-session.ts';
import { getDepartment, getManagerOptions } from '../../../../../lib/company.ts';
import { DeleteButton } from '../../../delete-button.tsx';
import { deleteDepartmentAction, updateDepartmentAction } from '../../actions.ts';
import { DepartmentForm } from '../../department-form.tsx';

export const dynamic = 'force-dynamic';

/** Sửa, xoá phòng ban (TASK-105). */
export default async function DepartmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await accessToken();
  const [department, managers] = await Promise.all([
    getDepartment(token, id),
    getManagerOptions(token),
  ]);
  if (!department.ok && (department.status === 404 || department.status === 400)) {
    notFound();
  }
  const failure = !department.ok ? department : !managers.ok ? managers : null;

  return (
    <main className="page">
      <p>
        <Link href="/company">← Công ty</Link>
      </p>
      {failure || !department.ok || !managers.ok ? (
        <div className="card">
          <p className="form-error" role="alert">
            {failure?.status === 403 ? 'Bạn chưa có quyền quản lý công ty.' : failure?.message}
          </p>
        </div>
      ) : (
        <>
          <div className="page-heading">
            <div>
              <h1>{department.data.name}</h1>
              <p className="muted">
                {department.data.userCount} người dùng · {department.data.teamCount} team
              </p>
            </div>
          </div>
          <section className="card">
            <DepartmentForm
              action={updateDepartmentAction.bind(null, department.data.id)}
              managers={managers.data}
              initial={{
                name: department.data.name,
                managerId: department.data.manager?.id ?? '',
              }}
              submitLabel="Lưu thay đổi"
            />
          </section>
          <section className="card">
            <h2>Xoá phòng ban</h2>
            <p className="muted">Chỉ xoá được khi phòng ban không còn người dùng và team nào.</p>
            <DeleteButton
              action={deleteDepartmentAction.bind(null, department.data.id)}
              label="Xoá phòng ban"
              confirmText={`Xoá phòng ban "${department.data.name}"?`}
            />
          </section>
        </>
      )}
    </main>
  );
}
