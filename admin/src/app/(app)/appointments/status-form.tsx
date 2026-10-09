'use client';

import { useActionState, useState } from 'react';

import { APPOINTMENT_STATUS_LABELS, OUTCOME_LABELS } from '../../../lib/appointments.ts';

interface State {
  error: string | null;
}

/** Đổi trạng thái lịch hẹn; chọn "Đã xem" thì hiện ô kết quả buổi xem (không bắt buộc). */
export function StatusForm({
  action,
  status,
  outcome,
}: {
  action: (state: State, formData: FormData) => Promise<State>;
  status: string;
  outcome: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [selected, setSelected] = useState(status);
  return (
    <form action={formAction} className="inline-form">
      <select
        name="status"
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
        aria-label="Trạng thái"
      >
        {Object.entries(APPOINTMENT_STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {selected === 'COMPLETED' && (
        <select name="outcome" defaultValue={outcome ?? ''} aria-label="Kết quả buổi xem">
          <option value="">Chưa ghi kết quả</option>
          {Object.entries(OUTCOME_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      )}
      <button type="submit" className="button button-secondary" disabled={pending}>
        Lưu trạng thái
      </button>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
