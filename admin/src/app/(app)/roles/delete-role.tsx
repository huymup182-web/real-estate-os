'use client';

import { useActionState } from 'react';

type Action = (
  state: { error: string | null },
  formData: FormData,
) => Promise<{ error: string | null }>;

/** Nút xoá vai trò, hỏi xác nhận trước; lỗi từ backend hiện ngay dưới nút. */
export function DeleteRole({ action, name }: { action: Action; name: string }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(`Xoá vai trò "${name}"?`)) {
          event.preventDefault();
        }
      }}
    >
      <button type="submit" className="button button-danger" disabled={pending}>
        {pending ? 'Đang xoá…' : 'Xoá vai trò'}
      </button>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
