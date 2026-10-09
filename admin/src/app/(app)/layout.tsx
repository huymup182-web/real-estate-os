import type { ReactNode } from 'react';

import { currentUser } from '../../lib/auth/auth-api.ts';
import { navItemsFor } from '../../lib/auth/permissions.ts';
import { accessToken } from '../../lib/auth/server-session.ts';
import { unreadCount } from '../../lib/notifications.ts';
import { logoutAction } from '../auth-actions.ts';
import { NavLink } from './nav-link.tsx';

function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button type="submit" className="button button-secondary">
        Đăng xuất
      </button>
    </form>
  );
}

/**
 * Khung các trang sau đăng nhập: tên công ty, người dùng, menu theo quyền (kèm số thông báo chưa đọc), nút
 * đăng xuất.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const token = await accessToken();
  const [me, unread] = await Promise.all([currentUser(token), unreadCount(token)]);
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

  const { user, company } = me.data;
  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <strong>{company ? company.name : 'Tài khoản nền tảng'}</strong>
          <span className="muted"> · {user.fullName}</span>
        </div>
        <LogoutButton />
      </header>
      <nav className="nav" aria-label="Menu chính">
        {navItemsFor(me.data).map((item) => (
          <NavLink
            key={item.href}
            href={item.href}
            label={item.label}
            badge={item.href === '/notifications' && unread.ok ? unread.data.count : 0}
          />
        ))}
      </nav>
      {children}
    </div>
  );
}
