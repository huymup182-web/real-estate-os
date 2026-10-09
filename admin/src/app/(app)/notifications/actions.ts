'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { accessToken } from '../../../lib/auth/server-session.ts';
import {
  deleteSavedSearch,
  markAllRead,
  markRead,
  notificationLink,
  setSavedSearchNotify,
} from '../../../lib/notifications.ts';

interface ActionState {
  error: string | null;
}

/** Số chưa đọc nằm ở menu (layout), nên làm mới cả layout sau mỗi thay đổi. */
function refresh(): void {
  revalidatePath('/', 'layout');
}

/**
 * Mở thông báo: đánh dấu đã đọc rồi chuyển tới trang liên quan. Link lấy lại từ thông báo backend trả về
 * (không nhận từ form) nên luôn là đường dẫn nội bộ.
 */
export async function openNotificationAction(id: string): Promise<ActionState> {
  const result = await markRead(await accessToken(), id);
  if (!result.ok) {
    return { error: result.message };
  }
  refresh();
  redirect(notificationLink(result.data) ?? '/notifications');
}

export async function markReadAction(id: string): Promise<ActionState> {
  const result = await markRead(await accessToken(), id);
  if (!result.ok) {
    return { error: result.message };
  }
  refresh();
  return { error: null };
}

export async function markAllReadAction(): Promise<ActionState> {
  const result = await markAllRead(await accessToken());
  if (!result.ok) {
    return { error: result.message };
  }
  refresh();
  redirect(`/notifications?saved=read-all&count=${result.data.count}`);
}

export async function toggleSavedSearchAction(id: string, notify: boolean): Promise<ActionState> {
  const result = await setSavedSearchNotify(await accessToken(), id, notify);
  if (!result.ok) {
    return { error: result.message };
  }
  refresh();
  return { error: null };
}

export async function deleteSavedSearchAction(id: string): Promise<ActionState> {
  const result = await deleteSavedSearch(await accessToken(), id);
  if (!result.ok) {
    return { error: result.message };
  }
  refresh();
  return { error: null };
}
