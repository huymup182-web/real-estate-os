'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { assistDeal, getAiStatus } from '../../../lib/ai.ts';
import { accessToken } from '../../../lib/auth/server-session.ts';
import {
  changeDealStage,
  createDeal,
  createDealPayload,
  DEAL_STAGE_LABELS,
  type DealFormState,
  deleteDeal,
  readDealForm,
  updateDeal,
  updateDealPayload,
  validateDealForm,
} from '../../../lib/deals.ts';
import { fieldErrorsFrom } from '../../../lib/users.ts';
import type { AiAssistState } from './ai-assistant.tsx';

interface ActionState {
  error: string | null;
}

const CONFLICT = 'Giao dịch vừa được người khác sửa. Tải lại trang rồi thử lại.';

/** Tạo giao dịch (TASK-110): người tạo là môi giới của giao dịch, bước "Đang thương lượng". */
export async function createDealAction(
  _previous: DealFormState,
  formData: FormData,
): Promise<DealFormState> {
  const values = readDealForm(formData);
  const fieldErrors = validateDealForm(values);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors, values };
  }
  const result = await createDeal(await accessToken(), createDealPayload(values));
  if (!result.ok) {
    return { error: result.message, fieldErrors: fieldErrorsFrom(result.details), values };
  }
  revalidatePath('/deals');
  redirect(`/deals/${result.data.id}?saved=created`);
}

/**
 * Sửa giao dịch `id` (giá chốt, cọc, ghi chú). `updatedAt` là bản người dùng đang sửa: ai khác lưu trước thì
 * backend trả 409. `depositAt` là mốc cọc cũ, gửi lại nguyên mốc khi người dùng không đổi ngày.
 */
export async function updateDealAction(
  id: string,
  updatedAt: string,
  depositAt: string | null,
  _previous: DealFormState,
  formData: FormData,
): Promise<DealFormState> {
  const values = readDealForm(formData);
  const fieldErrors = validateDealForm(values, false);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors, values };
  }
  const result = await updateDeal(await accessToken(), id, {
    ...updateDealPayload(values, depositAt),
    expectedUpdatedAt: updatedAt,
  });
  if (!result.ok) {
    return {
      error: result.status === 409 ? CONFLICT : result.message,
      fieldErrors: fieldErrorsFrom(result.details),
      values,
    };
  }
  revalidatePath('/deals');
  redirect(`/deals/${id}?saved=updated`);
}

/** Chuyển bước; sang "Thành công" cần đã có giá chốt (backend báo lỗi nếu chưa). */
export async function changeStageAction(
  id: string,
  updatedAt: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const value = formData.get('stage');
  const stage = typeof value === 'string' ? value : '';
  if (!Object.hasOwn(DEAL_STAGE_LABELS, stage)) {
    return { error: 'Vui lòng chọn bước' };
  }
  const result = await changeDealStage(await accessToken(), id, {
    stage,
    expectedUpdatedAt: updatedAt,
  });
  if (!result.ok) {
    return { error: result.status === 409 ? CONFLICT : result.message };
  }
  revalidatePath('/deals');
  redirect(`/deals/${id}?saved=stage`);
}

export async function deleteDealAction(id: string): Promise<ActionState> {
  const result = await deleteDeal(await accessToken(), id);
  if (!result.ok) {
    return { error: result.message };
  }
  revalidatePath('/deals');
  redirect('/deals?saved=deleted');
}

/** Trợ lý bán hàng AI cho giao dịch `id` (TASK-142): chỉ đọc, không sửa giao dịch. */
export async function aiAssistAction(id: string, previous: AiAssistState): Promise<AiAssistState> {
  const token = await accessToken();
  const result = await assistDeal(token, id);
  // Số lượt còn lại đổi sau mỗi lần hỏi; không đọc được thì giữ số đang hiện.
  const status = await getAiStatus(token);
  const remaining = status.ok ? status.data.remaining : previous.remaining;
  if (!result.ok) {
    return { error: result.message, result: previous.result, remaining };
  }
  return { error: null, result: result.data, remaining };
}
