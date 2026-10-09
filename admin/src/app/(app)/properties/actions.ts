'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { accessToken } from '../../../lib/auth/server-session.ts';
import {
  assignProperty,
  changePropertyStatus,
  createProperty,
  deleteProperty,
  getWards,
  type LocationOption,
  type PropertyFormState,
  propertyPayload,
  readPropertyForm,
  SETTABLE_STATUSES,
  updateProperty,
  validatePropertyForm,
  verifyProperty,
} from '../../../lib/properties.ts';
import { fieldErrorsFrom } from '../../../lib/users.ts';

interface ActionState {
  error: string | null;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** Phường/xã của tỉnh, cho ô chọn trên form (gọi từ client khi đổi tỉnh). */
export async function loadWardsAction(provinceId: string): Promise<LocationOption[]> {
  if (!provinceId) {
    return [];
  }
  const result = await getWards(await accessToken(), provinceId);
  return result.ok ? result.data : [];
}

/** Tạo BĐS (TASK-107, API TASK-049): người tạo là môi giới phụ trách. */
export async function createPropertyAction(
  _previous: PropertyFormState,
  formData: FormData,
): Promise<PropertyFormState> {
  const values = readPropertyForm(formData);
  const fieldErrors = validatePropertyForm(values);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors, values };
  }
  const result = await createProperty(await accessToken(), propertyPayload(values, true));
  if (!result.ok) {
    return { error: result.message, fieldErrors: fieldErrorsFrom(result.details), values };
  }
  revalidatePath('/properties');
  redirect(`/properties/${result.data.id}?saved=created`);
}

/**
 * Sửa BĐS `id`. `updatedAt` là bản người dùng đang sửa: ai khác lưu trước thì backend trả 409.
 * `withStreetAddress` = người dùng xem được địa chỉ chi tiết.
 */
export async function updatePropertyAction(
  id: string,
  updatedAt: string,
  withStreetAddress: boolean,
  _previous: PropertyFormState,
  formData: FormData,
): Promise<PropertyFormState> {
  const values = readPropertyForm(formData);
  const fieldErrors = validatePropertyForm(values);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors, values };
  }
  const result = await updateProperty(await accessToken(), id, {
    ...propertyPayload(values, withStreetAddress),
    expectedUpdatedAt: updatedAt,
  });
  if (!result.ok) {
    const error =
      result.status === 409
        ? 'BĐS vừa được người khác sửa. Tải lại trang để xem bản mới rồi sửa lại.'
        : result.message;
    return { error, fieldErrors: fieldErrorsFrom(result.details), values };
  }
  revalidatePath('/properties');
  redirect(`/properties/${id}?saved=updated`);
}

function conflictMessage(status: number, message: string): string {
  return status === 409 ? 'BĐS vừa được người khác sửa. Tải lại trang rồi thử lại.' : message;
}

export async function changeStatusAction(
  id: string,
  updatedAt: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const status = field(formData, 'status');
  if (!(SETTABLE_STATUSES as readonly string[]).includes(status)) {
    return { error: 'Trạng thái không hợp lệ' };
  }
  const result = await changePropertyStatus(await accessToken(), id, {
    status,
    expectedUpdatedAt: updatedAt,
  });
  if (!result.ok) {
    return { error: conflictMessage(result.status, result.message) };
  }
  revalidatePath('/properties');
  redirect(`/properties/${id}?saved=status`);
}

export async function verifyAction(id: string, updatedAt: string): Promise<ActionState> {
  const result = await verifyProperty(await accessToken(), id, { expectedUpdatedAt: updatedAt });
  if (!result.ok) {
    return { error: conflictMessage(result.status, result.message) };
  }
  revalidatePath('/properties');
  redirect(`/properties/${id}?saved=verified`);
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
  const result = await assignProperty(await accessToken(), id, {
    agentId,
    expectedUpdatedAt: updatedAt,
  });
  if (!result.ok) {
    return { error: conflictMessage(result.status, result.message) };
  }
  revalidatePath('/properties');
  redirect(`/properties/${id}?saved=assigned`);
}

export async function deletePropertyAction(id: string): Promise<ActionState> {
  const result = await deleteProperty(await accessToken(), id);
  if (!result.ok) {
    return { error: result.message };
  }
  revalidatePath('/properties');
  redirect('/properties?saved=deleted');
}
