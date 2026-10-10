import Link from 'next/link';

import { accessToken } from '../../../../lib/auth/server-session.ts';
import { getUserOptions } from '../../../../lib/users.ts';
import { createUserAction } from '../actions.ts';
import { UserForm } from '../user-form.tsx';

export const dynamic = 'force-dynamic';

/** Tạo người dùng (TASK-103). Cần `user.manage`; không có quyền thì backend trả 403. */
export default async function NewUserPage() {
  const options = await getUserOptions(await accessToken());
  return (
    <main className="page">
      <p>
        <Link href="/users">← Người dùng</Link>
      </p>
      <h1>Thêm người dùng</h1>
      <div className="card">
        {options.ok ? (
          <UserForm
            action={createUserAction}
            options={options.data}
            initial={{ fullName: '', email: '', phone: '', departmentId: '', roleIds: [] }}
            withPassword
            submitLabel="Tạo người dùng"
          />
        ) : (
          <p className="form-error" role="alert">
            {options.status === 403 ? 'Bạn chưa có quyền tạo người dùng.' : options.message}
          </p>
        )}
      </div>
    </main>
  );
}
