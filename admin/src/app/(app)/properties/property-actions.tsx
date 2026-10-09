'use client';

import { useActionState } from 'react';

import { PROPERTY_STATUS_LABELS, SETTABLE_STATUSES } from '../../../lib/properties.ts';

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

/** Đổi trạng thái BĐS (Đang bán, Đang giao dịch, Đã bán, Đã ẩn). */
export function StatusForm({ action, status }: { action: Action; status: string }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form action={formAction} className="inline-form">
      <select
        name="status"
        defaultValue={(SETTABLE_STATUSES as readonly string[]).includes(status) ? status : ''}
        aria-label="Trạng thái mới"
      >
        <option value="" disabled>
          Chọn trạng thái
        </option>
        {SETTABLE_STATUSES.map((value) => (
          <option key={value} value={value}>
            {PROPERTY_STATUS_LABELS[value]}
          </option>
        ))}
      </select>
      <button type="submit" className="button button-secondary" disabled={pending}>
        Đổi trạng thái
      </button>
      <ErrorText state={state} />
    </form>
  );
}

/** Xác minh BĐS: ghi nhận vừa kiểm tra lại, mở bán lại nếu đang chờ xác minh. */
export function VerifyForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form action={formAction} className="inline-form">
      <button type="submit" className="button button-secondary" disabled={pending}>
        {pending ? 'Đang xác minh…' : 'Xác minh BĐS'}
      </button>
      <ErrorText state={state} />
    </form>
  );
}

/** Giao BĐS cho môi giới khác. */
export function AssignForm({
  action,
  agents,
  agentId,
}: {
  action: Action;
  agents: { id: string; fullName: string }[];
  agentId: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form action={formAction} className="inline-form">
      <select name="agentId" defaultValue={agentId} aria-label="Môi giới phụ trách">
        {!agents.some((agent) => agent.id === agentId) && <option value="">Chọn môi giới</option>}
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.fullName}
          </option>
        ))}
      </select>
      <button type="submit" className="button button-secondary" disabled={pending}>
        Giao BĐS
      </button>
      <ErrorText state={state} />
    </form>
  );
}
