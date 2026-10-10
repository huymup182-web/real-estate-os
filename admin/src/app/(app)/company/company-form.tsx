'use client';

import { useActionState } from 'react';

import {
  type CompanyFormValues,
  type FormState,
  MAX_VERIFY_INTERVAL_DAYS,
} from '../../../lib/company.ts';

type Action = (
  state: FormState<CompanyFormValues>,
  formData: FormData,
) => Promise<FormState<CompanyFormValues>>;

function FieldError({ message }: { message: string | undefined }) {
  return message ? <span className="field-error">{message}</span> : null;
}

/** Form thông tin công ty: tên và số ngày phải xác minh lại BĐS. */
export function CompanyForm({
  action,
  initial,
  defaultDays,
}: {
  action: Action;
  initial: CompanyFormValues;
  defaultDays: number;
}) {
  const [state, formAction, pending] = useActionState(action, {
    error: null,
    fieldErrors: {},
    values: initial,
  });
  const { values, fieldErrors } = state;
  return (
    <form action={formAction} className="form" noValidate key={JSON.stringify(values)}>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      <label className="field">
        <span>Tên công ty</span>
        <input name="name" defaultValue={values.name} maxLength={255} required />
        <FieldError message={fieldErrors['name']} />
      </label>
      <label className="field">
        <span>Chu kỳ xác minh lại BĐS (ngày)</span>
        <input
          name="verifyIntervalDays"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_VERIFY_INTERVAL_DAYS}
          step={1}
          defaultValue={values.verifyIntervalDays}
          required
        />
        <span className="muted hint">
          BĐS quá số ngày này chưa được xác minh lại sẽ chuyển sang "Cần xác minh". Mặc định{' '}
          {defaultDays} ngày.
        </span>
        <FieldError message={fieldErrors['verifyIntervalDays']} />
      </label>
      <div>
        <button type="submit" className="button" disabled={pending}>
          {pending ? 'Đang lưu…' : 'Lưu thay đổi'}
        </button>
      </div>
    </form>
  );
}
