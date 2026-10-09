import { type BackendDeps, type BackendResult, callBackend, type ErrorDetail } from './backend.ts';

export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'LOCKED';
export const USER_STATUSES: readonly UserStatus[] = ['ACTIVE', 'INACTIVE', 'LOCKED'];

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  ACTIVE: 'Đang hoạt động',
  INACTIVE: 'Ngừng hoạt động',
  LOCKED: 'Đã khoá',
};

/** `GET /users`, `GET /users/:id` (TASK-103). */
export interface User {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  status: UserStatus;
  department: { id: string; name: string } | null;
  roles: { id: string; code: string; name: string }[];
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserFormOptions {
  roles: { id: string; code: string; name: string }[];
  departments: { id: string; name: string }[];
}

type SearchParams = Record<string, string | string[] | undefined>;

export interface UserFilters {
  q: string;
  status: UserStatus | '';
  roleId: string;
  departmentId: string;
  page: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const USER_PAGE_SIZE = 20;

function single(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Bộ lọc danh sách từ query của trang; giá trị sai thì bỏ qua thay vì để backend báo lỗi. */
export function userFilters(params: SearchParams): UserFilters {
  const status = single(params['status']);
  const roleId = single(params['roleId']);
  const departmentId = single(params['departmentId']);
  const page = Number(single(params['page']));
  return {
    q: single(params['q']).slice(0, 100),
    status: (USER_STATUSES as readonly string[]).includes(status) ? (status as UserStatus) : '',
    roleId: UUID.test(roleId) ? roleId : '',
    departmentId: UUID.test(departmentId) ? departmentId : '',
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/** Query string cho bộ lọc (bỏ giá trị rỗng và trang 1), dùng cho cả backend lẫn link phân trang. */
export function filterQuery(filters: UserFilters, page = filters.page): string {
  const query = new URLSearchParams();
  for (const key of ['q', 'status', 'roleId', 'departmentId'] as const) {
    if (filters[key]) {
      query.set(key, filters[key]);
    }
  }
  if (page > 1) {
    query.set('page', String(page));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

export function listUsers(
  token: string,
  filters: UserFilters,
  deps?: BackendDeps,
): Promise<BackendResult<User[]>> {
  const query = new URLSearchParams(filterQuery(filters).slice(1));
  query.set('page', String(filters.page));
  query.set('pageSize', String(USER_PAGE_SIZE));
  return callBackend<User[]>(`/users?${query.toString()}`, { accessToken: token }, deps);
}

export function getUser(token: string, id: string, deps?: BackendDeps) {
  return callBackend<User>(`/users/${encodeURIComponent(id)}`, { accessToken: token }, deps);
}

export function getUserOptions(token: string, deps?: BackendDeps) {
  return callBackend<UserFormOptions>('/users/options', { accessToken: token }, deps);
}

export function createUser(token: string, body: CreateUserPayload, deps?: BackendDeps) {
  return callBackend<User>('/users', { method: 'POST', body, accessToken: token }, deps);
}

export function updateUser(token: string, id: string, body: UpdateUserPayload, deps?: BackendDeps) {
  return callBackend<User>(
    `/users/${encodeURIComponent(id)}`,
    { method: 'PATCH', body, accessToken: token },
    deps,
  );
}

export function changeUserStatus(
  token: string,
  id: string,
  status: UserStatus,
  deps?: BackendDeps,
) {
  return callBackend<User>(
    `/users/${encodeURIComponent(id)}/status`,
    { method: 'POST', body: { status }, accessToken: token },
    deps,
  );
}

export interface UpdateUserPayload {
  fullName: string;
  email: string | null;
  phone: string | null;
  departmentId: string | null;
  roleIds: string[];
}

export interface CreateUserPayload extends UpdateUserPayload {
  password: string;
}

/** Giá trị form người dùng giữ lại khi lỗi (không bao giờ giữ mật khẩu). */
export interface UserFormValues {
  fullName: string;
  email: string;
  phone: string;
  departmentId: string;
  roleIds: string[];
}

export interface UserFormState {
  error: string | null;
  fieldErrors: Record<string, string>;
  values: UserFormValues;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export function readUserForm(formData: FormData): UserFormValues {
  return {
    fullName: field(formData, 'fullName'),
    email: field(formData, 'email'),
    phone: field(formData, 'phone').replace(/[\s.-]/g, ''),
    departmentId: field(formData, 'departmentId'),
    roleIds: formData
      .getAll('roleIds')
      .filter((value): value is string => typeof value === 'string'),
  };
}

/** Dữ liệu gửi backend: ô để trống = không có (null). Backend kiểm tra lại toàn bộ. */
export function userPayload(values: UserFormValues): UpdateUserPayload {
  return {
    fullName: values.fullName,
    email: values.email || null,
    phone: values.phone || null,
    departmentId: values.departmentId || null,
    roleIds: values.roleIds,
  };
}

/** Lỗi trên form trước khi gửi; trả `{}` khi hợp lệ. */
export function validateUserForm(values: UserFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!values.fullName) {
    errors['fullName'] = 'Vui lòng nhập họ tên';
  }
  if (!values.email && !values.phone) {
    errors['email'] = 'Cần email hoặc số điện thoại để đăng nhập';
  }
  if (values.roleIds.length === 0) {
    errors['roleIds'] = 'Chọn ít nhất một vai trò';
  }
  return errors;
}

/** Gom lỗi theo trường từ `error.details` của backend (trường đầu tiên thắng). */
export function fieldErrorsFrom(details: ErrorDetail[] | undefined): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const detail of details ?? []) {
    if (detail.field && !errors[detail.field]) {
      errors[detail.field] = detail.message;
    }
  }
  return errors;
}

/** Thao tác đổi trạng thái hiện được cho user đang ở trạng thái `status`. */
export function statusActions(status: UserStatus): { status: UserStatus; label: string }[] {
  const actions: { status: UserStatus; label: string }[] = [
    { status: 'ACTIVE', label: 'Kích hoạt' },
    { status: 'INACTIVE', label: 'Ngừng hoạt động' },
    { status: 'LOCKED', label: 'Khoá tài khoản' },
  ];
  return actions.filter((action) => action.status !== status);
}
