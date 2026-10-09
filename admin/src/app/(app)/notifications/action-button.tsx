'use client';

import { useActionState } from 'react';

interface State {
  error: string | null;
}

/** Nút gọi một server action không cần nhập liệu; `confirmText` thì hỏi trước; lỗi hiện cạnh nút. */
export function ActionButton({
  action,
  label,
  pendingLabel,
  className = 'button button-secondary',
  confirmText,
}: {
  action: (state: State) => Promise<State>;
  label: string;
  pendingLabel?: string;
  className?: string;
  confirmText?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form
      action={formAction}
      className="inline-form"
      onSubmit={(event) => {
        if (confirmText && !window.confirm(confirmText)) {
          event.preventDefault();
        }
      }}
    >
      <button type="submit" className={className} disabled={pending}>
        {pending && pendingLabel ? pendingLabel : label}
      </button>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
