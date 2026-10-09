'use client';

import { useActionState } from 'react';

type Action = (
  state: { error: string | null },
  formData: FormData,
) => Promise<{ error: string | null }>;

/** Nút xoá có hỏi xác nhận trước; lỗi từ backend hiện ngay dưới nút (vai trò, phòng ban). */
export function DeleteButton({
  action,
  label,
  confirmText,
}: {
  action: Action;
  label: string;
  confirmText: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(confirmText)) {
          event.preventDefault();
        }
      }}
    >
      <button type="submit" className="button button-danger" disabled={pending}>
        {pending ? 'Đang xoá…' : label}
      </button>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
