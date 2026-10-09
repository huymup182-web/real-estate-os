'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { accessToken } from '../../../lib/auth/server-session.ts';
import {
  type CompanyFormValues,
  companyPayload,
  createDepartment,
  deleteDepartment,
  type DepartmentFormValues,
  departmentPayload,
  type FormState,
  readCompanyForm,
  readDepartmentForm,
  updateCompany,
  updateDepartment,
  validateCompanyForm,
  validateDepartmentForm,
} from '../../../lib/company.ts';
import { fieldErrorsFrom } from '../../../lib/users.ts';

/** Sửa tên công ty và chu kỳ xác minh BĐS (TASK-105). Backend kiểm `admin.manage`. */
export async function updateCompanyAction(
  _previous: FormState<CompanyFormValues>,
  formData: FormData,
): Promise<FormState<CompanyFormValues>> {
  const values = readCompanyForm(formData);
  const fieldErrors = validateCompanyForm(values);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors, values };
  }
  const result = await updateCompany(await accessToken(), companyPayload(values));
  if (!result.ok) {
    return { error: result.message, fieldErrors: fieldErrorsFrom(result.details), values };
  }
  // Tên công ty hiện ở thanh trên của mọi trang.
  revalidatePath('/', 'layout');
  redirect('/company?saved=company');
}

export async function createDepartmentAction(
  _previous: FormState<DepartmentFormValues>,
  formData: FormData,
): Promise<FormState<DepartmentFormValues>> {
  const values = readDepartmentForm(formData);
  const fieldErrors = validateDepartmentForm(values);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors, values };
  }
  const result = await createDepartment(await accessToken(), departmentPayload(values));
  if (!result.ok) {
    return { error: result.message, fieldErrors: fieldErrorsFrom(result.details), values };
  }
  revalidatePath('/company');
  redirect('/company?saved=department-created');
}

export async function updateDepartmentAction(
  id: string,
  _previous: FormState<DepartmentFormValues>,
  formData: FormData,
): Promise<FormState<DepartmentFormValues>> {
  const values = readDepartmentForm(formData);
  const fieldErrors = validateDepartmentForm(values);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors, values };
  }
  const result = await updateDepartment(await accessToken(), id, departmentPayload(values));
  if (!result.ok) {
    return { error: result.message, fieldErrors: fieldErrorsFrom(result.details), values };
  }
  revalidatePath('/company');
  redirect('/company?saved=department-updated');
}

/** Xoá phòng ban `id`; còn người dùng hoặc team thì backend từ chối, lỗi hiện cạnh nút. */
export async function deleteDepartmentAction(id: string): Promise<{ error: string | null }> {
  const result = await deleteDepartment(await accessToken(), id);
  if (!result.ok) {
    return { error: result.message };
  }
  revalidatePath('/company');
  redirect('/company?saved=department-deleted');
}
