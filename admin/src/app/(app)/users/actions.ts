'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { accessToken } from '../../../lib/auth/server-session.ts';
import {
  changeUserStatus,
  createUser,
  fieldErrorsFrom,
  readUserForm,
  updateUser,
  userPayload,
  type UserFormState,
  type UserStatus,
  USER_STATUSES,
  validateUserForm,
} from '../../../lib/users.ts';

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/** Tạo người dùng (TASK-103). Backend kiểm quyền `user.manage` và mọi quy tắc; lỗi hiện lại trên form. */
export async function createUserAction(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const values = readUserForm(formData);
  const password = field(formData, 'password');
  const fieldErrors = validateUserForm(values);
  if (password.length < 8) {
    fieldErrors['password'] = 'Mật khẩu cần ít nhất 8 ký tự';
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors, values };
  }

  const result = await createUser(await accessToken(), { ...userPayload(values), password });
  if (!result.ok) {
    return { error: result.message, fieldErrors: fieldErrorsFrom(result.details), values };
  }
  revalidatePath('/users');
  redirect(`/users/${result.data.id}?saved=created`);
}

/** Sửa thông tin, phòng ban, vai trò của người dùng `id`. */
export async function updateUserAction(
  id: string,
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const values = readUserForm(formData);
  const fieldErrors = validateUserForm(values);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors, values };
  }
  const result = await updateUser(await accessToken(), id, userPayload(values));
  if (!result.ok) {
    return { error: result.message, fieldErrors: fieldErrorsFrom(result.details), values };
  }
  revalidatePath('/users');
  redirect(`/users/${id}?saved=updated`);
}

/** Đổi trạng thái tài khoản; lỗi (vd quản trị cuối cùng) trả về để hiện cạnh các nút. */
export async function changeStatusAction(
  id: string,
  _previous: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const status = field(formData, 'status');
  if (!(USER_STATUSES as readonly string[]).includes(status)) {
    return { error: 'Trạng thái không hợp lệ' };
  }
  const result = await changeUserStatus(await accessToken(), id, status as UserStatus);
  if (!result.ok) {
    return { error: result.message };
  }
  revalidatePath('/users');
  redirect(`/users/${id}?saved=status`);
}
