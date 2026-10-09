'use client';

import { useActionState } from 'react';

import type { DepartmentFormValues, FormState, ManagerOption } from '../../../lib/company.ts';

type Action = (
  state: FormState<DepartmentFormValues>,
  formData: FormData,
) => Promise<FormState<DepartmentFormValues>>;

function FieldError({ message }: { message: string | undefined }) {
  return message ? <span className="field-error">{message}</span> : null;
}

/** Form tạo/sửa phòng ban: tên và trưởng phòng (người dùng đang hoạt động). */
export function DepartmentForm({
  action,
  managers,
  initial,
  submitLabel,
}: {
  action: Action;
  managers: ManagerOption[];
  initial: DepartmentFormValues;
  submitLabel: string;
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
        <span>Tên phòng ban</span>
        <input name="name" defaultValue={values.name} maxLength={255} required />
        <FieldError message={fieldErrors['name']} />
      </label>
      <label className="field">
        <span>Trưởng phòng</span>
        <select name="managerId" defaultValue={values.managerId}>
          <option value="">Chưa có</option>
          {managers.map((manager) => (
            <option key={manager.id} value={manager.id}>
              {manager.email ? `${manager.fullName} (${manager.email})` : manager.fullName}
            </option>
          ))}
        </select>
        <FieldError message={fieldErrors['managerId']} />
      </label>
      <div>
        <button type="submit" className="button" disabled={pending}>
          {pending ? 'Đang lưu…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
