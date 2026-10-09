'use client';

import { useActionState } from 'react';

import {
  type CustomerFormState,
  type CustomerFormValues,
  PURPOSE_LABELS,
  SOURCE_LABELS,
  TIMELINE_LABELS,
} from '../../../lib/customers.ts';

type Action = (state: CustomerFormState, formData: FormData) => Promise<CustomerFormState>;

function FieldError({ message }: { message: string | undefined }) {
  return message ? <span className="field-error">{message}</span> : null;
}

/** Form thêm/sửa khách hàng. Ô chọn để trống nghĩa là chưa rõ (khi sửa thì xoá giá trị cũ). */
export function CustomerForm({
  action,
  initial,
  submitLabel,
}: {
  action: Action;
  initial: CustomerFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {
    error: null,
    fieldErrors: {},
    values: initial,
  });
  const { values, fieldErrors } = state;

  const choice = (
    name: keyof CustomerFormValues,
    label: string,
    options: Record<string, string>,
  ) => (
    <label className="field">
      <span>{label}</span>
      <select name={name} defaultValue={values[name]}>
        <option value="">Chưa rõ</option>
        {Object.entries(options).map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
      <FieldError message={fieldErrors[name]} />
    </label>
  );

  return (
    <form action={formAction} className="form" noValidate key={JSON.stringify(values)}>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      <label className="field">
        <span>Họ tên</span>
        <input name="fullName" defaultValue={values.fullName} maxLength={255} required />
        <FieldError message={fieldErrors['fullName']} />
      </label>
      <div className="field-row">
        <label className="field">
          <span>Số điện thoại</span>
          <input
            name="phone"
            type="tel"
            defaultValue={values.phone}
            placeholder="0901234567"
            required
          />
          <FieldError message={fieldErrors['phone']} />
        </label>
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" defaultValue={values.email} maxLength={255} />
          <FieldError message={fieldErrors['email']} />
        </label>
      </div>
      <div className="field-row">
        {choice('purpose', 'Mục đích', PURPOSE_LABELS)}
        {choice('purchaseTimeline', 'Thời gian mua', TIMELINE_LABELS)}
        {choice('source', 'Nguồn khách', SOURCE_LABELS)}
      </div>
      <label className="field">
        <span>Ghi chú</span>
        <textarea name="notes" defaultValue={values.notes} maxLength={5000} rows={4} />
        <FieldError message={fieldErrors['notes']} />
      </label>
      <div>
        <button type="submit" className="button" disabled={pending}>
          {pending ? 'Đang lưu…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
