'use client';

import { useActionState } from 'react';

import type { DealFormState, DealFormValues } from '../../../lib/deals.ts';

type Action = (state: DealFormState, formData: FormData) => Promise<DealFormState>;

interface Option {
  id: string;
  label: string;
}

function FieldError({ message }: { message: string | undefined }) {
  return message ? <span className="field-error">{message}</span> : null;
}

/**
 * Form tạo/sửa giao dịch. `options = null` khi sửa: khách và BĐS của giao dịch không đổi được (tạo giao
 * dịch mới thay vì đổi). Số tiền tính bằng đồng.
 */
export function DealForm({
  action,
  initial,
  options,
  submitLabel,
}: {
  action: Action;
  initial: DealFormValues;
  options: { customers: Option[]; properties: Option[] } | null;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {
    error: null,
    fieldErrors: {},
    values: initial,
  });
  const { values, fieldErrors } = state;

  const picker = (name: 'customerId' | 'propertyId', label: string, items: Option[]) => (
    <label className="field">
      <span>{label}</span>
      <select name={name} defaultValue={values[name]} required>
        <option value="">Chọn {label.toLowerCase()}</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
      <FieldError message={fieldErrors[name]} />
    </label>
  );

  const amount = (name: 'dealPrice' | 'depositAmount', label: string) => (
    <label className="field">
      <span>{label}</span>
      <input name={name} inputMode="numeric" defaultValue={values[name]} placeholder="3500000000" />
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
      {options && picker('customerId', 'Khách', options.customers)}
      {options && picker('propertyId', 'BĐS', options.properties)}
      <div className="field-row">
        {amount('dealPrice', 'Giá chốt (đồng)')}
        {amount('depositAmount', 'Tiền cọc (đồng)')}
        <label className="field">
          <span>Ngày cọc</span>
          <input name="depositAt" type="date" defaultValue={values.depositAt} />
          <FieldError message={fieldErrors['depositAt']} />
        </label>
      </div>
      <label className="field">
        <span>Ghi chú</span>
        <textarea name="notes" defaultValue={values.notes} maxLength={5000} rows={3} />
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
