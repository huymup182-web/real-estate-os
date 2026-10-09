'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { loginWithBackend, logoutWithBackend } from '../lib/auth/auth-api.ts';
import { type LoginFormState, readLoginForm, validateLoginForm } from '../lib/auth/login-form.ts';
import { LOGIN_PATH } from '../lib/auth/paths.ts';
import {
  ACCESS_COOKIE,
  clearedSessionCookies,
  type SessionCookie,
  sessionCookies,
} from '../lib/auth/session-cookies.ts';

async function setCookies(list: SessionCookie[]): Promise<void> {
  const store = await cookies();
  for (const cookie of list) {
    store.set(cookie.name, cookie.value, cookie.options);
  }
}

/**
 * Đăng nhập (TASK-101): gọi `POST /auth/login` từ phía server rồi lưu token vào cookie HttpOnly.
 * Lỗi trả lại câu thông báo của backend (sai thông tin → 401, tài khoản/công ty bị khoá → 403).
 */
export async function loginAction(
  _previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const values = readLoginForm(formData);
  const invalid = validateLoginForm(values);
  if (invalid) {
    return { error: invalid, identifier: values.identifier };
  }

  const userAgent = (await headers()).get('user-agent');
  const result = await loginWithBackend(
    { identifier: values.identifier, password: values.password },
    userAgent,
  );
  if (!result.ok) {
    return { error: result.message, identifier: values.identifier };
  }

  await setCookies(sessionCookies(result.data));
  redirect(values.next);
}

/** Đăng xuất: thu hồi phiên ở backend (lỗi thì bỏ qua), xoá cookie rồi về trang đăng nhập. */
export async function logoutAction(): Promise<void> {
  const accessToken = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (accessToken) {
    await logoutWithBackend(accessToken);
  }
  await setCookies(clearedSessionCookies());
  redirect(LOGIN_PATH);
}
