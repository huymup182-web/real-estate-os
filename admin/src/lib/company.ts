import { type BackendDeps, callBackend } from './backend.ts';

/** `GET /company` (TASK-105). */
export interface Company {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
  settings: { verifyIntervalDays: number; verifyIntervalDaysDefault: number };
  stats: { users: number; departments: number; teams: number };
}

export const COMPANY_STATUS_LABELS: Record<Company['status'], string> = {
  ACTIVE: 'Đang hoạt động',
  SUSPENDED: 'Tạm ngưng',
};

/** `GET /departments` (TASK-105). */
export interface Department {
  id: string;
  name: string;
  manager: { id: string; fullName: string } | null;
  userCount: number;
  teamCount: number;
}

export interface ManagerOption {
  id: string;
  fullName: string;
  email: string | null;
}

/** Khớp giới hạn của backend (`MAX_VERIFY_INTERVAL_DAYS`). */
export const MAX_VERIFY_INTERVAL_DAYS = 365;

export function getCompany(token: string, deps?: BackendDeps) {
  return callBackend<Company>('/company', { accessToken: token }, deps);
}

export function updateCompany(token: string, body: CompanyPayload, deps?: BackendDeps) {
  return callBackend<Company>('/company', { method: 'PATCH', body, accessToken: token }, deps);
}

export function listDepartments(token: string, deps?: BackendDeps) {
  return callBackend<Department[]>('/departments', { accessToken: token }, deps);
}

export function getDepartment(token: string, id: string, deps?: BackendDeps) {
  return callBackend<Department>(
    `/departments/${encodeURIComponent(id)}`,
    { accessToken: token },
    deps,
  );
}

export function getManagerOptions(token: string, deps?: BackendDeps) {
  return callBackend<ManagerOption[]>('/departments/manager-options', { accessToken: token }, deps);
}

export function createDepartment(token: string, body: DepartmentPayload, deps?: BackendDeps) {
  return callBackend<Department>(
    '/departments',
    { method: 'POST', body, accessToken: token },
    deps,
  );
}

export function updateDepartment(
  token: string,
  id: string,
  body: DepartmentPayload,
  deps?: BackendDeps,
) {
  return callBackend<Department>(
    `/departments/${encodeURIComponent(id)}`,
    { method: 'PATCH', body, accessToken: token },
    deps,
  );
}

export function deleteDepartment(token: string, id: string, deps?: BackendDeps) {
  return callBackend<null>(
    `/departments/${encodeURIComponent(id)}`,
    { method: 'DELETE', accessToken: token },
    deps,
  );
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export interface CompanyFormValues {
  name: string;
  verifyIntervalDays: string;
}

export interface CompanyPayload {
  name: string;
  verifyIntervalDays: number;
}

export interface FormState<V> {
  error: string | null;
  fieldErrors: Record<string, string>;
  values: V;
}

export function readCompanyForm(formData: FormData): CompanyFormValues {
  return { name: text(formData, 'name'), verifyIntervalDays: text(formData, 'verifyIntervalDays') };
}

export function validateCompanyForm(values: CompanyFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!values.name) {
    errors['name'] = 'Vui lòng nhập tên công ty';
  }
  const days = Number(values.verifyIntervalDays);
  if (!/^\d+$/.test(values.verifyIntervalDays) || days < 1 || days > MAX_VERIFY_INTERVAL_DAYS) {
    errors['verifyIntervalDays'] = `Nhập số ngày từ 1 đến ${MAX_VERIFY_INTERVAL_DAYS}`;
  }
  return errors;
}

export function companyPayload(values: CompanyFormValues): CompanyPayload {
  return { name: values.name, verifyIntervalDays: Number(values.verifyIntervalDays) };
}

export interface DepartmentFormValues {
  name: string;
  managerId: string;
}

export interface DepartmentPayload {
  name: string;
  managerId: string | null;
}

export function readDepartmentForm(formData: FormData): DepartmentFormValues {
  return { name: text(formData, 'name'), managerId: text(formData, 'managerId') };
}

export function validateDepartmentForm(values: DepartmentFormValues): Record<string, string> {
  return values.name ? {} : { name: 'Vui lòng nhập tên phòng ban' };
}

export function departmentPayload(values: DepartmentFormValues): DepartmentPayload {
  return { name: values.name, managerId: values.managerId || null };
}
