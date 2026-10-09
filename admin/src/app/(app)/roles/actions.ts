'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { accessToken } from '../../../lib/auth/server-session.ts';
import {
  createRole,
  deleteRole,
  readRoleForm,
  rolePayload,
  type RoleFormState,
  updateRole,
  validateRoleForm,
} from '../../../lib/roles.ts';
import { fieldErrorsFrom } from '../../../lib/users.ts';

/** Tạo vai trò (TASK-104). Backend kiểm `admin.manage`, mã trùng và quyền vượt quá quyền người tạo. */
export async function createRoleAction(
  _previous: RoleFormState,
  formData: FormData,
): Promise<RoleFormState> {
  const values = readRoleForm(formData);
  const fieldErrors = validateRoleForm(values, true);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors, values };
  }
  const result = await createRole(await accessToken(), {
    code: values.code,
    ...rolePayload(values),
  });
  if (!result.ok) {
    return { error: result.message, fieldErrors: fieldErrorsFrom(result.details), values };
  }
  revalidatePath('/roles');
  redirect(`/roles/${result.data.id}?saved=created`);
}

/**
 * Sửa vai trò `id`. `permissionsLocked` (vai trò quản trị công ty) chỉ gửi tên và mô tả,
 * vì quyền của vai trò này bị khoá.
 */
export async function updateRoleAction(
  id: string,
  permissionsLocked: boolean,
  _previous: RoleFormState,
  formData: FormData,
): Promise<RoleFormState> {
  const values = readRoleForm(formData);
  const fieldErrors = validateRoleForm(values, false);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors, values };
  }
  const payload = rolePayload(values);
  const body = permissionsLocked
    ? { name: payload.name, description: payload.description }
    : payload;
  const result = await updateRole(await accessToken(), id, body);
  if (!result.ok) {
    return { error: result.message, fieldErrors: fieldErrorsFrom(result.details), values };
  }
  revalidatePath('/roles');
  redirect(`/roles/${id}?saved=updated`);
}

/** Xoá vai trò `id`; lỗi (vai trò mặc định, còn người dùng) hiện cạnh nút xoá. */
export async function deleteRoleAction(id: string): Promise<{ error: string | null }> {
  const result = await deleteRole(await accessToken(), id);
  if (!result.ok) {
    return { error: result.message };
  }
  revalidatePath('/roles');
  redirect('/roles?saved=deleted');
}
