import Link from 'next/link';

import { accessToken } from '../../../../../lib/auth/server-session.ts';
import { getManagerOptions } from '../../../../../lib/company.ts';
import { createDepartmentAction } from '../../actions.ts';
import { DepartmentForm } from '../../department-form.tsx';

export const dynamic = 'force-dynamic';

/** Thêm phòng ban (TASK-105). Không có `admin.manage` thì backend trả 403. */
export default async function NewDepartmentPage() {
  const managers = await getManagerOptions(await accessToken());
  return (
    <main className="page">
      <p>
        <Link href="/company">← Công ty</Link>
      </p>
      <h1>Thêm phòng ban</h1>
      <div className="card">
        {managers.ok ? (
          <DepartmentForm
            action={createDepartmentAction}
            managers={managers.data}
            initial={{ name: '', managerId: '' }}
            submitLabel="Thêm phòng ban"
          />
        ) : (
          <p className="form-error" role="alert">
            {managers.status === 403 ? 'Bạn chưa có quyền quản lý công ty.' : managers.message}
          </p>
        )}
      </div>
    </main>
  );
}
