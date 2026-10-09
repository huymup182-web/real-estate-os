'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  APPOINTMENT_STATUS_LABELS,
  type AppointmentFormState,
  changeAppointmentStatus,
  createAppointment,
  createAppointmentPayload,
  deleteAppointment,
  OUTCOME_LABELS,
  readAppointmentForm,
  updateAppointment,
  updateAppointmentPayload,
  validateAppointmentForm,
} from '../../../lib/appointments.ts';
import { accessToken } from '../../../lib/auth/server-session.ts';
import { fieldErrorsFrom } from '../../../lib/users.ts';

interface ActionState {
  error: string | null;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** Đặt lịch hẹn (TASK-109, API TASK-083): người đặt là môi giới của lịch, trạng thái "Đã hẹn". */
export async function createAppointmentAction(
  _previous: AppointmentFormState,
  formData: FormData,
): Promise<AppointmentFormState> {
  const values = readAppointmentForm(formData);
  const fieldErrors = validateAppointmentForm(values);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors, values };
  }
  const result = await createAppointment(await accessToken(), createAppointmentPayload(values));
  if (!result.ok) {
    return { error: result.message, fieldErrors: fieldErrorsFrom(result.details), values };
  }
  revalidatePath('/appointments');
  redirect(`/appointments/${result.data.id}?saved=created`);
}

/**
 * Sửa lịch `id` (không đổi khách). `updatedAt` là bản người dùng đang sửa: ai khác lưu trước thì backend
 * trả 409. `scheduledAt` là giờ hẹn cũ, gửi lại nguyên mốc khi người dùng không đổi giờ.
 */
export async function updateAppointmentAction(
  id: string,
  updatedAt: string,
  scheduledAt: string,
  _previous: AppointmentFormState,
  formData: FormData,
): Promise<AppointmentFormState> {
  const values = readAppointmentForm(formData);
  const fieldErrors = validateAppointmentForm(values, false);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors, values };
  }
  const result = await updateAppointment(await accessToken(), id, {
    ...updateAppointmentPayload(values, scheduledAt),
    expectedUpdatedAt: updatedAt,
  });
  if (!result.ok) {
    const error =
      result.status === 409
        ? 'Lịch hẹn vừa được người khác sửa. Tải lại trang để xem bản mới rồi sửa lại.'
        : result.message;
    return { error, fieldErrors: fieldErrorsFrom(result.details), values };
  }
  revalidatePath('/appointments');
  redirect(`/appointments/${id}?saved=updated`);
}

/** Đổi trạng thái lịch; "Đã xem" kèm kết quả buổi xem (không bắt buộc). */
export async function changeStatusAction(
  id: string,
  updatedAt: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const status = field(formData, 'status');
  if (!Object.hasOwn(APPOINTMENT_STATUS_LABELS, status)) {
    return { error: 'Vui lòng chọn trạng thái' };
  }
  const outcome = status === 'COMPLETED' ? field(formData, 'outcome') : '';
  if (outcome && !Object.hasOwn(OUTCOME_LABELS, outcome)) {
    return { error: 'Kết quả không hợp lệ' };
  }
  const result = await changeAppointmentStatus(await accessToken(), id, {
    status,
    ...(outcome ? { outcome } : {}),
    expectedUpdatedAt: updatedAt,
  });
  if (!result.ok) {
    return {
      error:
        result.status === 409
          ? 'Lịch hẹn vừa được người khác sửa. Tải lại trang rồi thử lại.'
          : result.message,
    };
  }
  revalidatePath('/appointments');
  redirect(`/appointments/${id}?saved=status`);
}

export async function deleteAppointmentAction(id: string): Promise<ActionState> {
  const result = await deleteAppointment(await accessToken(), id);
  if (!result.ok) {
    return { error: result.message };
  }
  revalidatePath('/appointments');
  redirect('/appointments?saved=deleted');
}
