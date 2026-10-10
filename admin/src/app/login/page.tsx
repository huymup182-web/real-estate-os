import type { Metadata } from 'next';

import { safeNextPath } from '../../lib/auth/paths.ts';
import { LoginForm } from './login-form.tsx';

export const metadata: Metadata = { title: 'Đăng nhập · AI Real Estate OS' };

/** Trang đăng nhập web quản trị (TASK-101). `?next=` là trang quay lại sau khi đăng nhập. */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  return (
    <main className="auth-page">
      <div className="card">
        <h1>Đăng nhập</h1>
        <p className="muted">Web quản trị AI Real Estate OS</p>
        <LoginForm next={safeNextPath(typeof next === 'string' ? next : null)} />
      </div>
    </main>
  );
}
