import { fromLocalInput } from './appointments.ts';
import { type BackendDeps, type BackendResult, callBackend } from './backend.ts';

/** Loại đối tượng backend ghi nhật ký (`entity_type`). */
export const ENTITY_TYPE_LABELS = {
  property: 'BĐS',
  customer: 'Khách hàng',
  appointment: 'Lịch hẹn',
  deal: 'Giao dịch',
  user: 'Người dùng',
  role: 'Vai trò',
  team: 'Team',
  department: 'Phòng ban',
  company: 'Công ty',
} as const;
export type EntityType = keyof typeof ENTITY_TYPE_LABELS;

/** Phần sau dấu chấm của `action` (vd `property.update` → `update`). */
const VERB_LABELS: Record<string, string> = {
  create: 'Tạo',
  update: 'Sửa',
  delete: 'Xoá',
  status: 'Đổi trạng thái',
  change_status: 'Đổi trạng thái',
  change_stage: 'Đổi bước',
  assign: 'Giao người phụ trách',
  verify: 'Xác minh',
  approve: 'Duyệt',
  verification_expired: 'Hết hạn xác minh',
  add_image: 'Thêm ảnh',
  remove_image: 'Xoá ảnh',
  reorder_images: 'Sắp xếp ảnh',
  set_cover_image: 'Đặt ảnh bìa',
  add_document: 'Thêm giấy tờ',
  remove_document: 'Xoá giấy tờ',
  view_documents: 'Xem giấy tờ',
  set_owner: 'Đặt chủ nhà',
  remove_owner: 'Xoá chủ nhà',
  view_owner_contact: 'Xem liên hệ chủ nhà',
  create_share_link: 'Tạo link chia sẻ',
  revoke_share_link: 'Thu hồi link chia sẻ',
  add_preference: 'Thêm nhu cầu',
  update_preference: 'Sửa nhu cầu',
  remove_preference: 'Xoá nhu cầu',
};

/** `GET /audit-logs`. `changes` dạng `{field: [cũ, mới]}`. */
export interface AuditLog {
  id: string;
  user: { id: string; fullName: string } | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  changes: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
}

export const AUDIT_PAGE_SIZE = 30;

type SearchParams = Record<string, string | string[] | undefined>;

export interface AuditFilters {
  entityType: EntityType | '';
  entityId: string;
  userId: string;
  action: string;
  /** Ngày `YYYY-MM-DD` theo giờ Việt Nam, gồm cả hai đầu. */
  from: string;
  to: string;
  page: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION = /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEYS = ['entityType', 'entityId', 'userId', 'action', 'from', 'to'] as const;

function single(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validDate(value: string): boolean {
  return DATE.test(value) && fromLocalInput(`${value}T00:00`) !== null;
}

/** Bộ lọc từ query của trang; giá trị sai thì bỏ qua thay vì để backend báo lỗi. */
export function auditFilters(params: SearchParams): AuditFilters {
  const entityType = single(params['entityType']);
  const entityId = single(params['entityId']);
  const userId = single(params['userId']);
  const action = single(params['action']);
  const from = single(params['from']);
  const to = single(params['to']);
  const page = Number(single(params['page']));
  const validFrom = validDate(from) ? from : '';
  return {
    entityType: Object.hasOwn(ENTITY_TYPE_LABELS, entityType) ? (entityType as EntityType) : '',
    entityId: UUID.test(entityId) ? entityId : '',
    userId: UUID.test(userId) ? userId : '',
    action: ACTION.test(action) && action.length <= 100 ? action : '',
    from: validFrom,
    to: validDate(to) && (!validFrom || to >= validFrom) ? to : '',
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/** Query của trang nhật ký; `changes` cho phép bỏ hoặc thay vài bộ lọc (vd bấm tên người để lọc). */
export function auditQuery(
  filters: AuditFilters,
  page = filters.page,
  changes: Partial<Omit<AuditFilters, 'page'>> = {},
): string {
  const merged = { ...filters, ...changes };
  const query = new URLSearchParams();
  for (const key of KEYS) {
    if (merged[key]) {
      query.set(key, merged[key]);
    }
  }
  if (page > 1) {
    query.set('page', String(page));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

/** Query gửi backend: ngày theo giờ Việt Nam; `to` gồm cả ngày đó nên gửi 0 giờ ngày hôm sau. */
export function auditApiQuery(filters: AuditFilters): string {
  const query = new URLSearchParams();
  for (const key of ['entityType', 'entityId', 'userId', 'action'] as const) {
    if (filters[key]) {
      query.set(key, filters[key]);
    }
  }
  if (filters.from) {
    query.set('from', `${filters.from}T00:00:00+07:00`);
  }
  if (filters.to) {
    const next = new Date(Date.parse(`${filters.to}T00:00:00Z`) + 24 * 60 * 60 * 1000);
    query.set('to', `${next.toISOString().slice(0, 10)}T00:00:00+07:00`);
  }
  query.set('page', String(filters.page));
  query.set('pageSize', String(AUDIT_PAGE_SIZE));
  return query.toString();
}

export function listAuditLogs(
  token: string,
  filters: AuditFilters,
  deps?: BackendDeps,
): Promise<BackendResult<AuditLog[]>> {
  return callBackend<AuditLog[]>(
    `/audit-logs?${auditApiQuery(filters)}`,
    { accessToken: token },
    deps,
  );
}

/** "Sửa", "Đổi bước"...; thao tác lạ thì hiện nguyên mã. */
export function actionLabel(action: string): string {
  const verb = action.slice(action.indexOf('.') + 1);
  return Object.hasOwn(VERB_LABELS, verb) ? (VERB_LABELS[verb] ?? action) : action;
}

export function entityLabel(entityType: string | null): string {
  if (!entityType) {
    return '—';
  }
  return Object.hasOwn(ENTITY_TYPE_LABELS, entityType)
    ? ENTITY_TYPE_LABELS[entityType as EntityType]
    : entityType;
}

/** Trang admin của đối tượng (id phải là UUID); không có trang riêng thì null. */
export function entityHref(entityType: string | null, entityId: string | null): string | null {
  if (entityType === 'company') {
    return '/company';
  }
  if (!entityId || !UUID.test(entityId)) {
    return null;
  }
  const base: Record<string, string> = {
    property: '/properties',
    customer: '/customers',
    appointment: '/appointments',
    deal: '/deals',
    user: '/users',
    role: '/roles',
    team: '/teams',
    department: '/company/departments',
  };
  return entityType && Object.hasOwn(base, entityType) ? `${base[entityType]}/${entityId}` : null;
}

/** Giá trị trong `changes` để hiện: null → "—", chuỗi giữ nguyên, còn lại JSON; dài quá thì cắt. */
export function changeValue(value: unknown, max = 120): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Các dòng thay đổi `[trường, cũ, mới]`; giá trị không theo dạng `[cũ, mới]` thì để cũ trống. */
export function changeRows(changes: Record<string, unknown> | null): [string, string, string][] {
  if (!changes) {
    return [];
  }
  return Object.entries(changes).map(([field, value]) =>
    Array.isArray(value) && value.length === 2
      ? [field, changeValue(value[0]), changeValue(value[1])]
      : [field, '—', changeValue(value)],
  );
}
