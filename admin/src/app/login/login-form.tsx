'use client';

import { useActionState } from 'react';

import { IDENTIFIER_MAX_LENGTH, PASSWORD_MAX_LENGTH } from '../../lib/auth/login-form.ts';
import { loginAction } from '../auth-actions.ts';

/** Form đăng nhập bằng email hoặc số điện thoại + mật khẩu. Token không bao giờ tới trình duyệt. */
export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(loginAction, {
    error: null,
    identifier: '',
  });

  return (
    <form action={formAction} className="form" noValidate>
      <input type="hidden" name="next" value={next} />
      <label className="field">
        <span>Email hoặc số điện thoại</span>
        <input
          name="identifier"
          type="text"
          autoComplete="username"
          inputMode="email"
          maxLength={IDENTIFIER_MAX_LENGTH}
          defaultValue={state.identifier}
          required
          autoFocus
        />
      </label>
      <label className="field">
        <span>Mật khẩu</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          maxLength={PASSWORD_MAX_LENGTH}
          required
        />
      </label>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" className="button" disabled={pending}>
        {pending ? 'Đang đăng nhập…' : 'Đăng nhập'}
      </button>
    </form>
  );
}
