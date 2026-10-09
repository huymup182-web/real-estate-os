'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { accessToken } from '../../../lib/auth/server-session.ts';
import {
  addNote,
  assignCustomer,
  changeCustomerStatus,
  createCustomer,
  CUSTOMER_STATUS_LABELS,
  type CustomerFormState,
  customerPayload,
  deleteCustomer,
  readCustomerForm,
  updateCustomer,
  validateCustomerForm,
} from '../../../lib/customers.ts';
import { fieldErrorsFrom } from '../../../lib/users.ts';

interface ActionState {
  error: string | null;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function conflictMessage(status: number, message: string): string {
  return status === 409 ? 'Khách vừa được người khác sửa. Tải lại trang rồi thử lại.' : message;
}

/** Thêm khách (TASK-108, API TASK-077): người tạo là môi giới phụ trách, bước pipeline NEW. */
export async function createCustomerAction(
  _previous: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const values = readCustomerForm(formData);
  const fieldErrors = validateCustomerForm(values);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors, values };
  }
  const result = await createCustomer(await accessToken(), customerPayload(values));
  if (!result.ok) {
    return { error: result.message, fieldErrors: fieldErrorsFrom(result.details), values };
  }
  revalidatePath('/customers');
  redirect(`/customers/${result.data.id}?saved=created`);
}

/** Sửa khách `id`. `updatedAt` là bản người dùng đang sửa: ai khác lưu trước thì backend trả 409. */
export async function updateCustomerAction(
  id: string,
  updatedAt: string,
  _previous: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const values = readCustomerForm(formData);
  const fieldErrors = validateCustomerForm(values);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors, values };
  }
  const result = await updateCustomer(await accessToken(), id, {
    ...customerPayload(values),
    expectedUpdatedAt: updatedAt,
  });
  if (!result.ok) {
    const error =
      result.status === 409
        ? 'Khách vừa được người khác sửa. Tải lại trang để xem bản mới rồi sửa lại.'
        : result.message;
    return { error, fieldErrors: fieldErrorsFrom(result.details), values };
  }
  revalidatePath('/customers');
  redirect(`/customers/${id}?saved=updated`);
}

/** Chuyển bước pipeline; sang "Mất khách" bắt buộc lý do. */
export async function changeStatusAction(
  id: string,
  updatedAt: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const status = field(formData, 'status');
  if (!Object.hasOwn(CUSTOMER_STATUS_LABELS, status)) {
    return { error: 'Vui lòng chọn bước' };
  }
  const lostReason = field(formData, 'lostReason');
  if (status === 'LOST' && !lostReason) {
    return { error: 'Vui lòng nhập lý do mất khách' };
  }
  const result = await changeCustomerStatus(await accessToken(), id, {
    status,
    ...(status === 'LOST' ? { lostReason } : {}),
    expectedUpdatedAt: updatedAt,
  });
  if (!result.ok) {
    return { error: conflictMessage(result.status, result.message) };
  }
  revalidatePath('/customers');
  redirect(`/customers/${id}?saved=status`);
}

export async function assignAction(
  id: string,
  updatedAt: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const agentId = field(formData, 'agentId');
  if (!agentId) {
    return { error: 'Vui lòng chọn môi giới' };
  }
  const result = await assignCustomer(await accessToken(), id, {
    agentId,
    expectedUpdatedAt: updatedAt,
  });
  if (!result.ok) {
    return { error: conflictMessage(result.status, result.message) };
  }
  revalidatePath('/customers');
  redirect(`/customers/${id}?saved=assigned`);
}

export async function addNoteAction(
  id: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const content = field(formData, 'content');
  if (!content) {
    return { error: 'Vui lòng nhập ghi chú' };
  }
  const result = await addNote(await accessToken(), id, content);
  if (!result.ok) {
    return { error: result.message };
  }
  redirect(`/customers/${id}?saved=note`);
}

export async function deleteCustomerAction(id: string): Promise<ActionState> {
  const result = await deleteCustomer(await accessToken(), id);
  if (!result.ok) {
    return { error: result.message };
  }
  revalidatePath('/customers');
  redirect('/customers?saved=deleted');
}
