'use client';

import { useActionState } from 'react';

import { DEAL_STAGE_LABELS } from '../../../lib/deals.ts';

interface State {
  error: string | null;
}

/** Chuyển bước giao dịch. */
export function StageForm({
  action,
  stage,
}: {
  action: (state: State, formData: FormData) => Promise<State>;
  stage: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form action={formAction} className="inline-form">
      <select name="stage" defaultValue={stage} aria-label="Bước giao dịch">
        {Object.entries(DEAL_STAGE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <button type="submit" className="button button-secondary" disabled={pending}>
        Chuyển bước
      </button>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
