import { cookies } from 'next/headers';

import { currentUser } from '../lib/auth/auth-api.ts';
import { ACCESS_COOKIE } from '../lib/auth/session-cookies.ts';
import { logoutAction } from './auth-actions.ts';

/** Luôn render lúc request vì nội dung phụ thuộc người đăng nhập. */
export const dynamic = 'force-dynamic';

function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button type="submit" className="button button-secondary">
        Đăng xuất
      </button>
    </form>
  );
}

/** Trang chủ tạm: chào người đăng nhập và cho đăng xuất. Dashboard làm ở TASK-102. */
export default async function HomePage() {
  const accessToken = (await cookies()).get(ACCESS_COOKIE)?.value ?? '';
  const me = await currentUser(accessToken);

  if (!me.ok) {
    return (
      <main>
        <div className="card">
          <h1>AI Real Estate OS</h1>
          <p className="form-error" role="alert">
            {me.message}
          </p>
          <LogoutButton />
        </div>
      </main>
    );
  }

  const { user, company, roles } = me.data;
  return (
    <main>
      <div className="card">
        <h1>Xin chào, {user.fullName}</h1>
        <p className="muted">
          {company ? company.name : 'Tài khoản nền tảng'}
          {roles.length > 0 && ` · ${roles.map((role) => role.name).join(', ')}`}
        </p>
        <p>Web quản trị đang được xây dựng.</p>
        <LogoutButton />
      </div>
    </main>
  );
}
