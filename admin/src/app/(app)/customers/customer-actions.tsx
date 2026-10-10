'use client';

import { useActionState, useState } from 'react';

import { CUSTOMER_STATUS_LABELS, CUSTOMER_STATUSES } from '../../../lib/customers.ts';

interface State {
  error: string | null;
}
type Action = (state: State, formData: FormData) => Promise<State>;

function ErrorText({ state }: { state: State }) {
  return state.error ? (
    <p className="form-error" role="alert">
      {state.error}
    </p>
  ) : null;
}

/** Chuyển bước pipeline; chọn "Mất khách" thì hiện ô lý do (bắt buộc). */
export function StatusForm({
  action,
  status,
  lostReason,
}: {
  action: Action;
  status: string;
  lostReason: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [selected, setSelected] = useState(status);
  return (
    <form action={formAction} className="inline-form">
      <select
        name="status"
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
        aria-label="Bước mới"
      >
        {CUSTOMER_STATUSES.map((value) => (
          <option key={value} value={value}>
            {CUSTOMER_STATUS_LABELS[value]}
          </option>
        ))}
      </select>
      {selected === 'LOST' && (
        <input
          name="lostReason"
          defaultValue={lostReason ?? ''}
          maxLength={1000}
          placeholder="Lý do mất khách"
          aria-label="Lý do mất khách"
          required
        />
      )}
      <button type="submit" className="button button-secondary" disabled={pending}>
        Đổi bước
      </button>
      <ErrorText state={state} />
    </form>
  );
}

/** Giao khách cho môi giới khác. */
export function AssignForm({
  action,
  agents,
  agentId,
}: {
  action: Action;
  agents: { id: string; fullName: string }[];
  agentId: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const current = agentId && agents.some((agent) => agent.id === agentId) ? agentId : '';
  return (
    <form action={formAction} className="inline-form">
      <select name="agentId" defaultValue={current} aria-label="Môi giới phụ trách">
        {!current && <option value="">Chọn môi giới</option>}
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.fullName}
          </option>
        ))}
      </select>
      <button type="submit" className="button button-secondary" disabled={pending}>
        Giao khách
      </button>
      <ErrorText state={state} />
    </form>
  );
}

/** Thêm ghi chú lên timeline của khách. */
export function NoteForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form action={formAction} className="form">
      <label className="field">
        <span>Ghi chú mới</span>
        <textarea name="content" maxLength={5000} rows={3} required />
      </label>
      <ErrorText state={state} />
      <div>
        <button type="submit" className="button button-secondary" disabled={pending}>
          {pending ? 'Đang lưu…' : 'Thêm ghi chú'}
        </button>
      </div>
    </form>
  );
}
