'use client';

import { useActionState } from 'react';

import type { AppointmentFormState, AppointmentFormValues } from '../../../lib/appointments.ts';

type Action = (state: AppointmentFormState, formData: FormData) => Promise<AppointmentFormState>;

interface Option {
  id: string;
  label: string;
}

function FieldError({ message }: { message: string | undefined }) {
  return message ? <span className="field-error">{message}</span> : null;
}

/**
 * Form đặt/sửa lịch hẹn. `customers = null` khi sửa: khách của lịch không đổi được (đổi khách thì đặt lịch
 * mới). Ngày giờ hiểu theo giờ Việt Nam.
 */
export function AppointmentForm({
  action,
  initial,
  customers,
  properties,
  submitLabel,
}: {
  action: Action;
  initial: AppointmentFormValues;
  customers: Option[] | null;
  properties: Option[];
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {
    error: null,
    fieldErrors: {},
    values: initial,
  });
  const { values, fieldErrors } = state;

  const picker = (name: 'customerId' | 'propertyId', label: string, options: Option[]) => (
    <label className="field">
      <span>{label}</span>
      <select name={name} defaultValue={values[name]} required>
        <option value="">Chọn {label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
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
      {customers && picker('customerId', 'Khách', customers)}
      {picker('propertyId', 'BĐS', properties)}
      <div className="field-row">
        <label className="field">
          <span>Ngày giờ hẹn</span>
          <input
            name="scheduledAt"
            type="datetime-local"
            defaultValue={values.scheduledAt}
            required
          />
          <FieldError message={fieldErrors['scheduledAt']} />
        </label>
        <label className="field">
          <span>Thời lượng (phút)</span>
          <input
            name="durationMinutes"
            inputMode="numeric"
            defaultValue={values.durationMinutes}
            placeholder="60"
          />
          <FieldError message={fieldErrors['durationMinutes']} />
        </label>
      </div>
      <label className="field">
        <span>Điểm hẹn</span>
        <input
          name="location"
          defaultValue={values.location}
          maxLength={255}
          placeholder="Để trống nếu gặp tại BĐS"
        />
        <FieldError message={fieldErrors['location']} />
      </label>
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
