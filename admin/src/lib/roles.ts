import { type BackendDeps, callBackend } from './backend.ts';

export type RoleScope = 'OWN' | 'TEAM' | 'DEPARTMENT' | 'COMPANY';
export const ROLE_SCOPES: readonly RoleScope[] = ['OWN', 'TEAM', 'DEPARTMENT', 'COMPANY'];

export const SCOPE_OPTION_LABELS: Record<RoleScope, string> = {
  OWN: 'Của mình',
  TEAM: 'Nhóm',
  DEPARTMENT: 'Phòng ban',
  COMPANY: 'Toàn công ty',
};

export const MODULE_LABELS: Record<string, string> = {
  property: 'Bất động sản',
  customer: 'Khách hàng',
  appointment: 'Lịch hẹn',
  deal: 'Giao dịch',
  commission: 'Hoa hồng',
  user: 'Người dùng',
  team: 'Team',
  report: 'Báo cáo',
  admin: 'Quản trị',
  audit: 'Nhật ký',
};

export interface PermissionGrant {
  code: string;
  scope: RoleScope;
}

/** `GET /roles` (TASK-104). */
export interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionsLocked: boolean;
  userCount: number;
  permissionCount: number;
}

export interface RoleDetail extends Role {
  permissions: PermissionGrant[];
}

export interface PermissionInfo {
  code: string;
  module: string;
  description: string;
}

export function listRoles(token: string, deps?: BackendDeps) {
  return callBackend<Role[]>('/roles', { accessToken: token }, deps);
}

export function getRole(token: string, id: string, deps?: BackendDeps) {
  return callBackend<RoleDetail>(`/roles/${encodeURIComponent(id)}`, { accessToken: token }, deps);
}

export function getPermissionCatalog(token: string, deps?: BackendDeps) {
  return callBackend<PermissionInfo[]>('/roles/permissions', { accessToken: token }, deps);
}

export function createRole(
  token: string,
  body: RolePayload & { code: string },
  deps?: BackendDeps,
) {
  return callBackend<RoleDetail>('/roles', { method: 'POST', body, accessToken: token }, deps);
}

export function updateRole(
  token: string,
  id: string,
  body: Partial<RolePayload>,
  deps?: BackendDeps,
) {
  return callBackend<RoleDetail>(
    `/roles/${encodeURIComponent(id)}`,
    { method: 'PATCH', body, accessToken: token },
    deps,
  );
}

export function deleteRole(token: string, id: string, deps?: BackendDeps) {
  return callBackend<null>(
    `/roles/${encodeURIComponent(id)}`,
    { method: 'DELETE', accessToken: token },
    deps,
  );
}

/** Danh mục quyền gom theo module, giữ thứ tự module trong MODULE_LABELS (module lạ xếp cuối). */
export function groupByModule(catalog: readonly PermissionInfo[]) {
  const order = Object.keys(MODULE_LABELS);
  const groups = new Map<string, PermissionInfo[]>();
  for (const permission of catalog) {
    groups.set(permission.module, [...(groups.get(permission.module) ?? []), permission]);
  }
  const rank = (module: string): number =>
    order.includes(module) ? order.indexOf(module) : order.length;
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([module, permissions]) => ({
      module,
      label: MODULE_LABELS[module] ?? module,
      permissions,
    }));
}

export interface RolePayload {
  name: string;
  description: string | null;
  permissions: PermissionGrant[];
}

export interface RoleFormValues {
  code: string;
  name: string;
  description: string;
  /** permission code → phạm vi; quyền không chọn thì không có trong map. */
  scopes: Record<string, RoleScope>;
}

export interface RoleFormState {
  error: string | null;
  fieldErrors: Record<string, string>;
  values: RoleFormValues;
}

/** Tiền tố tên ô chọn phạm vi của một quyền trong form, vd `perm:property.view`. */
export const PERMISSION_FIELD_PREFIX = 'perm:';

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export function readRoleForm(formData: FormData): RoleFormValues {
  const scopes: Record<string, RoleScope> = {};
  for (const [name, value] of formData.entries()) {
    if (
      name.startsWith(PERMISSION_FIELD_PREFIX) &&
      typeof value === 'string' &&
      (ROLE_SCOPES as readonly string[]).includes(value)
    ) {
      scopes[name.slice(PERMISSION_FIELD_PREFIX.length)] = value as RoleScope;
    }
  }
  return {
    code: text(formData, 'code').toUpperCase(),
    name: text(formData, 'name'),
    description: text(formData, 'description'),
    scopes,
  };
}

export function rolePayload(values: RoleFormValues): RolePayload {
  return {
    name: values.name,
    description: values.description || null,
    permissions: Object.entries(values.scopes)
      .map(([code, scope]) => ({ code, scope }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  };
}

export function validateRoleForm(
  values: RoleFormValues,
  withCode: boolean,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (withCode && !/^[A-Z][A-Z0-9_]{0,49}$/.test(values.code)) {
    errors['code'] = 'Mã gồm chữ in hoa, số, dấu gạch dưới, bắt đầu bằng chữ (tối đa 50 ký tự)';
  }
  if (!values.name) {
    errors['name'] = 'Vui lòng nhập tên vai trò';
  }
  return errors;
}

export function roleFormValues(role: RoleDetail): RoleFormValues {
  return {
    code: role.code,
    name: role.name,
    description: role.description ?? '',
    scopes: Object.fromEntries(role.permissions.map((grant) => [grant.code, grant.scope])),
  };
}
