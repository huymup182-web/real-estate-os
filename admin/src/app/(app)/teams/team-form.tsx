'use client';

import { useActionState, useState } from 'react';

import {
  peopleFor,
  type TeamFormState,
  type TeamFormValues,
  type TeamMember,
  type TeamOptions,
} from '../../../lib/teams.ts';

type Action = (state: TeamFormState, formData: FormData) => Promise<TeamFormState>;

function FieldError({ message }: { message: string | undefined }) {
  return message ? <span className="field-error">{message}</span> : null;
}

/**
 * Form tạo/sửa team. Trưởng nhóm và thành viên chỉ chọn trong phòng ban đang chọn (quy tắc cùng phòng
 * ban); đổi phòng ban thì danh sách người đổi theo.
 */
export function TeamForm({
  action,
  options,
  initial,
  currentMembers,
  submitLabel,
}: {
  action: Action;
  options: TeamOptions;
  initial: TeamFormValues;
  currentMembers: TeamMember[];
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
      <Fields
        options={options}
        values={values}
        fieldErrors={fieldErrors}
        error={state.error}
        currentMembers={currentMembers}
      />
      <div>
        <button type="submit" className="button" disabled={pending}>
          {pending ? 'Đang lưu…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

function Fields({
  options,
  values,
  fieldErrors,
  error,
  currentMembers,
}: {
  options: TeamOptions;
  values: TeamFormValues;
  fieldErrors: Record<string, string>;
  error: string | null;
  currentMembers: TeamMember[];
}) {
  const [departmentId, setDepartmentId] = useState(values.departmentId);
  // Phòng ban hiện tại của team có thể nằm ngoài danh sách tạo được (vd vừa bị đổi quyền).
  const departments = options.departments.some((department) => department.id === departmentId)
    ? options.departments
    : values.departmentId
      ? [...options.departments, { id: values.departmentId, name: 'Phòng ban hiện tại' }]
      : options.departments;
  const people = peopleFor(
    options,
    departmentId,
    departmentId === values.departmentId ? currentMembers : [],
  );

  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="field-row">
        <label className="field">
          <span>Tên team</span>
          <input name="name" defaultValue={values.name} maxLength={255} required />
          <FieldError message={fieldErrors['name']} />
        </label>
        <label className="field">
          <span>Phòng ban</span>
          <select
            name="departmentId"
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
            required
          >
            <option value="">Chọn phòng ban</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
          <FieldError message={fieldErrors['departmentId']} />
        </label>
      </div>
      <label className="field">
        <span>Trưởng nhóm</span>
        <select name="leaderId" defaultValue={values.leaderId} key={`leader-${departmentId}`}>
          <option value="">Chưa có</option>
          {people
            .filter((person) => !person.inactive || person.id === values.leaderId)
            .map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
              </option>
            ))}
        </select>
        <FieldError message={fieldErrors['leaderId']} />
      </label>
      <fieldset className="field" key={`members-${departmentId}`}>
        <legend>Thành viên</legend>
        {people.length === 0 ? (
          <p className="muted">
            {departmentId
              ? 'Phòng ban này chưa có người dùng đang hoạt động.'
              : 'Chọn phòng ban để chọn thành viên.'}
          </p>
        ) : (
          <div className="checks">
            {people.map((person) => (
              <label key={person.id} className="check">
                <input
                  type="checkbox"
                  name="memberIds"
                  value={person.id}
                  defaultChecked={values.memberIds.includes(person.id)}
                />
                {person.fullName}
                {person.inactive && <span className="muted">(ngừng hoạt động)</span>}
              </label>
            ))}
          </div>
        )}
        <span className="muted hint">Trưởng nhóm và thành viên phải thuộc phòng ban của team.</span>
        <FieldError message={fieldErrors['memberIds']} />
      </fieldset>
    </>
  );
}
