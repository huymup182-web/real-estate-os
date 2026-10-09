'use client';

import { useActionState } from 'react';

import {
  groupByModule,
  PERMISSION_FIELD_PREFIX,
  type PermissionInfo,
  ROLE_SCOPES,
  type RoleFormState,
  type RoleFormValues,
  SCOPE_OPTION_LABELS,
} from '../../../lib/roles.ts';

type Action = (state: RoleFormState, formData: FormData) => Promise<RoleFormState>;

function FieldError({ message }: { message: string | undefined }) {
  return message ? <span className="field-error">{message}</span> : null;
}

/**
 * Form tạo/sửa vai trò: tên, mô tả và bảng quyền gom theo module, mỗi quyền chọn
 * "Không có" hoặc một phạm vi. `withCode` chỉ bật khi tạo mới (mã không đổi được).
 */
export function RoleForm({
  action,
  catalog,
  initial,
  withCode,
  permissionsLocked,
  submitLabel,
}: {
  action: Action;
  catalog: PermissionInfo[];
  initial: RoleFormValues;
  withCode: boolean;
  permissionsLocked: boolean;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {
    error: null,
    fieldErrors: {},
    values: initial,
  });
  const { values, fieldErrors } = state;
  const key = JSON.stringify(values);

  return (
    <form action={formAction} className="form" noValidate key={key}>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      <div className="field-row">
        {withCode && (
          <label className="field">
            <span>Mã vai trò</span>
            <input
              name="code"
              defaultValue={values.code}
              maxLength={50}
              placeholder="SENIOR_AGENT"
              autoComplete="off"
              required
            />
            <span className="muted hint">
              Chữ in hoa, số và dấu gạch dưới; không đổi được sau khi tạo.
            </span>
            <FieldError message={fieldErrors['code']} />
          </label>
        )}
        <label className="field">
          <span>Tên vai trò</span>
          <input name="name" defaultValue={values.name} maxLength={100} required />
          <FieldError message={fieldErrors['name']} />
        </label>
      </div>
      <label className="field">
        <span>Mô tả</span>
        <textarea name="description" defaultValue={values.description} maxLength={500} rows={2} />
        <FieldError message={fieldErrors['description']} />
      </label>

      <fieldset className="field">
        <legend>Quyền</legend>
        {permissionsLocked && (
          <p className="muted">
            Quyền của vai trò quản trị công ty được khoá để luôn có người quản trị được hệ thống;
            chỉ đổi được tên và mô tả.
          </p>
        )}
        <FieldError message={fieldErrors['permissions']} />
        <div className="permission-groups">
          {groupByModule(catalog).map((group) => (
            <div key={group.module} className="permission-group">
              <h3>{group.label}</h3>
              {group.permissions.map((permission) => (
                <label key={permission.code} className="permission-row">
                  <span>
                    {permission.description}
                    <code className="muted">{permission.code}</code>
                  </span>
                  <select
                    name={PERMISSION_FIELD_PREFIX + permission.code}
                    defaultValue={values.scopes[permission.code] ?? ''}
                    disabled={permissionsLocked}
                  >
                    <option value="">Không có</option>
                    {ROLE_SCOPES.map((scope) => (
                      <option key={scope} value={scope}>
                        {SCOPE_OPTION_LABELS[scope]}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          ))}
        </div>
      </fieldset>
      <div>
        <button type="submit" className="button" disabled={pending}>
          {pending ? 'Đang lưu…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
