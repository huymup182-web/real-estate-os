'use client';

import { useActionState } from 'react';

import type { UserFormOptions, UserFormState, UserFormValues } from '../../../lib/users.ts';

type Action = (state: UserFormState, formData: FormData) => Promise<UserFormState>;

function FieldError({ message }: { message: string | undefined }) {
  return message ? <span className="field-error">{message}</span> : null;
}

/** Form tạo/sửa người dùng. `withPassword` chỉ bật khi tạo mới: admin đặt mật khẩu ban đầu. */
export function UserForm({
  action,
  options,
  initial,
  withPassword,
  submitLabel,
}: {
  action: Action;
  options: UserFormOptions;
  initial: UserFormValues;
  withPassword: boolean;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {
    error: null,
    fieldErrors: {},
    values: initial,
  });
  const { values, fieldErrors } = state;
  // key theo giá trị trả về để ô nhập lấy lại giá trị cũ sau khi form bị React đặt lại.
  const key = JSON.stringify(values);

  return (
    <form action={formAction} className="form" noValidate key={key}>
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
          <span>Email</span>
          <input name="email" type="email" defaultValue={values.email} autoComplete="off" />
          <FieldError message={fieldErrors['email']} />
        </label>
        <label className="field">
          <span>Số điện thoại</span>
          <input
            name="phone"
            type="tel"
            defaultValue={values.phone}
            placeholder="+84901234567"
            autoComplete="off"
          />
          <FieldError message={fieldErrors['phone']} />
        </label>
      </div>
      {withPassword && (
        <label className="field">
          <span>Mật khẩu ban đầu</span>
          <input
            name="password"
            type="password"
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            required
          />
          <span className="muted hint">
            Ít nhất 8 ký tự. Nhân viên có thể đổi lại qua "Quên mật khẩu".
          </span>
          <FieldError message={fieldErrors['password']} />
        </label>
      )}
      <label className="field">
        <span>Phòng ban</span>
        <select name="departmentId" defaultValue={values.departmentId}>
          <option value="">Chưa thuộc phòng ban</option>
          {options.departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
        <FieldError message={fieldErrors['departmentId']} />
      </label>
      <fieldset className="field">
        <legend>Vai trò</legend>
        <div className="checks">
          {options.roles.map((role) => (
            <label key={role.id} className="check">
              <input
                type="checkbox"
                name="roleIds"
                value={role.id}
                defaultChecked={values.roleIds.includes(role.id)}
              />
              {role.name}
            </label>
          ))}
        </div>
        <FieldError message={fieldErrors['roleIds']} />
      </fieldset>
      <div>
        <button type="submit" className="button" disabled={pending}>
          {pending ? 'Đang lưu…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
