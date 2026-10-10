import { type BackendDeps, type BackendResult, callBackend } from './backend.ts';

/** Giá trị khớp backend `src/notifications/notification-values.ts`. */
export const NOTIFICATION_TYPE_LABELS = {
  NEW_PROPERTY: 'BĐS mới khớp tìm kiếm',
  PROPERTY_UPDATED: 'BĐS cập nhật',
  MATCHED_PROPERTY: 'BĐS hợp khách',
  CUSTOMER_ASSIGNED: 'Được giao khách',
  NEW_LEAD: 'Khách mới',
  VIEWING_REMINDER: 'Nhắc lịch hẹn',
  VERIFY_REQUIRED: 'Cần xác minh BĐS',
  SYSTEM_NOTIFICATION: 'Hệ thống',
} as const;
export type NotificationType = keyof typeof NOTIFICATION_TYPE_LABELS;

/** `GET /notifications`: thông báo của chính người đang đăng nhập. */
export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export const NOTIFICATION_PAGE_SIZE = 20;

type SearchParams = Record<string, string | string[] | undefined>;

export interface NotificationFilters {
  unread: boolean;
  type: NotificationType | '';
  page: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function single(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Bộ lọc từ query của trang; giá trị sai thì bỏ qua thay vì để backend báo lỗi. */
export function notificationFilters(params: SearchParams): NotificationFilters {
  const type = single(params['type']);
  const page = Number(single(params['page']));
  return {
    unread: single(params['unread']) === 'true',
    type: Object.hasOwn(NOTIFICATION_TYPE_LABELS, type) ? (type as NotificationType) : '',
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

export function notificationQuery(filters: NotificationFilters, page = filters.page): string {
  const query = new URLSearchParams();
  if (filters.unread) {
    query.set('unread', 'true');
  }
  if (filters.type) {
    query.set('type', filters.type);
  }
  if (page > 1) {
    query.set('page', String(page));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

export function listNotifications(
  token: string,
  filters: NotificationFilters,
  deps?: BackendDeps,
): Promise<BackendResult<Notification[]>> {
  const query = new URLSearchParams(notificationQuery(filters).slice(1));
  query.set('page', String(filters.page));
  query.set('pageSize', String(NOTIFICATION_PAGE_SIZE));
  return callBackend<Notification[]>(
    `/notifications?${query.toString()}`,
    { accessToken: token },
    deps,
  );
}

export function unreadCount(token: string, deps?: BackendDeps) {
  return callBackend<{ count: number }>(
    '/notifications/unread-count',
    { accessToken: token },
    deps,
  );
}

export function markRead(token: string, id: string, deps?: BackendDeps) {
  return callBackend<Notification>(
    `/notifications/${encodeURIComponent(id)}/read`,
    { method: 'POST', accessToken: token },
    deps,
  );
}

export function markAllRead(token: string, deps?: BackendDeps) {
  return callBackend<{ count: number }>(
    '/notifications/read-all',
    { method: 'POST', accessToken: token },
    deps,
  );
}

function idIn(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

/**
 * Trang admin liên quan tới thông báo, lấy từ `data` (id phải là UUID nên link luôn là đường dẫn nội bộ):
 * lịch hẹn, BĐS, khách; nhắc xác minh nhiều BĐS thì mở danh sách BĐS. Không có thì null.
 */
export function notificationLink(notification: Pick<Notification, 'type' | 'data'>): string | null {
  const { data } = notification;
  const appointmentId = idIn(data, 'appointmentId');
  if (appointmentId) {
    return `/appointments/${appointmentId}`;
  }
  const propertyId = idIn(data, 'propertyId');
  if (propertyId) {
    return `/properties/${propertyId}`;
  }
  const customerId = idIn(data, 'customerId');
  if (customerId) {
    return `/customers/${customerId}`;
  }
  if (notification.type === 'VERIFY_REQUIRED' && Array.isArray(data['propertyIds'])) {
    const ids = data['propertyIds'].filter(
      (id): id is string => typeof id === 'string' && UUID.test(id),
    );
    if (ids.length === 1) {
      return `/properties/${ids[0]}`;
    }
    return ids.length > 1 ? '/properties' : null;
  }
  return null;
}

/** `GET /saved-searches`: tìm kiếm BĐS đã lưu của chính mình; `notify` = nhận tin khi có BĐS mới khớp. */
export interface SavedSearch {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  notify: boolean;
  lastNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function listSavedSearches(token: string, deps?: BackendDeps) {
  return callBackend<SavedSearch[]>('/saved-searches?pageSize=100', { accessToken: token }, deps);
}

export function setSavedSearchNotify(
  token: string,
  id: string,
  notify: boolean,
  deps?: BackendDeps,
) {
  return callBackend<SavedSearch>(
    `/saved-searches/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: { notify }, accessToken: token },
    deps,
  );
}

export function deleteSavedSearch(token: string, id: string, deps?: BackendDeps) {
  return callBackend<null>(
    `/saved-searches/${encodeURIComponent(id)}`,
    { method: 'DELETE', accessToken: token },
    deps,
  );
}
