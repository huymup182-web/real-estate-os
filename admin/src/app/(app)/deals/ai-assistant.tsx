'use client';

import { useActionState } from 'react';

import type { AiSalesAssist } from '../../../lib/ai.ts';

export interface AiAssistState {
  error: string | null;
  result: AiSalesAssist | null;
  /** Số lượt AI còn lại sau lần hỏi gần nhất; `undefined` khi chưa hỏi lần nào. */
  remaining?: number | null;
}

function Points({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <>
      <h3>{title}</h3>
      <ul>
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </>
  );
}

/** Nút "Hỏi AI" và gợi ý của trợ lý bán hàng cho một giao dịch (TASK-142). */
export function AiAssistant({
  action,
  remaining: initialRemaining,
}: {
  action: (state: AiAssistState) => Promise<AiAssistState>;
  remaining: number | null;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null, result: null });
  const result = state.result;
  const remaining = state.remaining === undefined ? initialRemaining : state.remaining;
  return (
    <>
      <form action={formAction} className="inline-form">
        <button
          type="submit"
          className="button button-secondary"
          disabled={pending || remaining === 0}
        >
          {pending ? 'AI đang đọc giao dịch…' : result ? 'Hỏi lại AI' : 'Hỏi AI'}
        </button>
        {remaining !== null && <span className="muted">Còn {remaining} lượt AI trong 24 giờ.</span>}
      </form>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      {result && (
        <div className="ai-result" aria-live="polite">
          <p>{result.situation}</p>
          <Points title="Việc nên làm tiếp" items={result.nextSteps} />
          <Points title="Ý nói với khách" items={result.talkingPoints} />
          <Points title="Rủi ro cần lưu ý" items={result.risks} />
          <p className="muted">
            AI chỉ gợi ý từ dữ liệu của giao dịch, BĐS và khách mà bạn xem được. Nên kiểm lại trước
            khi làm.
          </p>
        </div>
      )}
    </>
  );
}
