'use client';

import { useActionState } from 'react';

import { statusActions, type UserStatus } from '../../../lib/users.ts';

type Action = (
  state: { error: string | null },
  formData: FormData,
) => Promise<{ error: string | null }>;

/** Nút đổi trạng thái tài khoản; lỗi từ backend hiện ngay dưới các nút. */
export function StatusActions({ action, status }: { action: Action; status: UserStatus }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form action={formAction}>
      <div className="actions">
        {statusActions(status).map((option) => (
          <button
            key={option.status}
            type="submit"
            name="status"
            value={option.status}
            disabled={pending}
            className={option.status === 'ACTIVE' ? 'button' : 'button button-secondary'}
          >
            {option.label}
          </button>
        ))}
      </div>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
