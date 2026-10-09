import { type BackendDeps, type BackendResult, callBackend } from './backend.ts';
import { formatArea, formatPrice, PROPERTY_TYPE_LABELS } from './properties.ts';

/** Giá trị khớp backend `src/customers/customer-values.ts`. */
export const CUSTOMER_STATUS_LABELS = {
  NEW: 'Mới',
  CONTACTED: 'Đã liên hệ',
  QUALIFIED: 'Có nhu cầu thật',
  VIEWING: 'Đi xem nhà',
  NEGOTIATING: 'Thương lượng',
  DEPOSIT: 'Đặt cọc',
  WON: 'Chốt thành công',
  LOST: 'Mất khách',
} as const;
export type CustomerStatus = keyof typeof CUSTOMER_STATUS_LABELS;
export const CUSTOMER_STATUSES = Object.keys(CUSTOMER_STATUS_LABELS) as CustomerStatus[];

export const PURPOSE_LABELS: Record<string, string> = {
  LIVING: 'Để ở',
  INVESTMENT: 'Đầu tư',
  RENT: 'Cho thuê',
  OTHER: 'Khác',
};

export const TIMELINE_LABELS: Record<string, string> = {
  IMMEDIATE: 'Mua ngay',
  WITHIN_3_MONTHS: 'Trong 3 tháng',
  WITHIN_6_MONTHS: 'Trong 6 tháng',
  OVER_6_MONTHS: 'Trên 6 tháng',
  UNKNOWN: 'Chưa rõ',
};

export const SOURCE_LABELS: Record<string, string> = {
  REFERRAL: 'Giới thiệu',
  WALK_IN: 'Khách tự đến',
  FACEBOOK: 'Facebook',
  ZALO: 'Zalo',
  TIKTOK: 'TikTok',
  WEBSITE: 'Website',
  BROKER_PARTNER: 'Đối tác môi giới',
  OLD_CUSTOMER: 'Khách cũ',
  OTHER: 'Khác',
};

export const TRANSACTION_LABELS: Record<string, string> = {
  SALE: 'Mua',
  RENT: 'Thuê',
};

export const ACTIVITY_LABELS: Record<string, string> = {
  CALL: 'Gọi điện',
  MESSAGE: 'Nhắn tin',
  PROPERTY_SENT: 'Gửi BĐS',
  VIEWING: 'Đi xem',
  NEGOTIATION: 'Thương lượng',
  DEPOSIT: 'Đặt cọc',
  NOTE: 'Ghi chú',
  STATUS_CHANGE: 'Đổi bước',
  ASSIGNMENT: 'Giao khách',
};

/** `GET /customers`, `GET /customers/:id`. */
export interface Customer {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  purpose: string | null;
  purchaseTimeline: string | null;
  source: string | null;
  agentId: string | null;
  status: CustomerStatus;
  lostReason: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerPreference {
  id: string;
  transactionType: string;
  propertyTypes: string[] | null;
  budgetMin: number | null;
  budgetMax: number | null;
  areaMin: number | null;
  areaMax: number | null;
  bedroomsMin: number | null;
  provinceIds: string[] | null;
  isActive: boolean;
}

export interface CustomerActivity {
  id: string;
  type: string;
  content: string | null;
  metadata: Record<string, unknown> | null;
  user: { id: string; fullName: string } | null;
  occurredAt: string;
}

export const CUSTOMER_PAGE_SIZE = 20;

type SearchParams = Record<string, string | string[] | undefined>;

export interface CustomerFilters {
  q: string;
  status: CustomerStatus | '';
  page: number;
}

function single(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Bộ lọc danh sách từ query của trang; giá trị sai thì bỏ qua thay vì để backend báo lỗi. */
export function customerFilters(params: SearchParams): CustomerFilters {
  const status = single(params['status']);
  const page = Number(single(params['page']));
  return {
    q: single(params['q']).slice(0, 100),
    status: Object.hasOwn(CUSTOMER_STATUS_LABELS, status) ? (status as CustomerStatus) : '',
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

export function customerQuery(filters: CustomerFilters, page = filters.page): string {
  const query = new URLSearchParams();
  for (const key of ['q', 'status'] as const) {
    if (filters[key]) {
      query.set(key, filters[key]);
    }
  }
  if (page > 1) {
    query.set('page', String(page));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

export function listCustomers(
  token: string,
  filters: CustomerFilters,
  deps?: BackendDeps,
): Promise<BackendResult<Customer[]>> {
  const query = new URLSearchParams(customerQuery(filters).slice(1));
  query.set('page', String(filters.page));
  query.set('pageSize', String(CUSTOMER_PAGE_SIZE));
  return callBackend<Customer[]>(`/customers?${query.toString()}`, { accessToken: token }, deps);
}

export function getPipeline(token: string, deps?: BackendDeps) {
  return callBackend<{ status: CustomerStatus; count: number }[]>(
    '/customers/pipeline',
    { accessToken: token },
    deps,
  );
}

const path = (id: string, suffix = ''): string => `/customers/${encodeURIComponent(id)}${suffix}`;

export function getCustomer(token: string, id: string, deps?: BackendDeps) {
  return callBackend<Customer>(path(id), { accessToken: token }, deps);
}

export function getPreferences(token: string, id: string, deps?: BackendDeps) {
  return callBackend<CustomerPreference[]>(path(id, '/preferences'), { accessToken: token }, deps);
}

export function getActivities(token: string, id: string, deps?: BackendDeps) {
  return callBackend<CustomerActivity[]>(
    path(id, '/activities?pageSize=20'),
    { accessToken: token },
    deps,
  );
}

export function createCustomer(token: string, body: CustomerPayload, deps?: BackendDeps) {
  return callBackend<Customer>('/customers', { method: 'POST', body, accessToken: token }, deps);
}

export function updateCustomer(
  token: string,
  id: string,
  body: CustomerPayload & { expectedUpdatedAt: string },
  deps?: BackendDeps,
) {
  return callBackend<Customer>(path(id), { method: 'PATCH', body, accessToken: token }, deps);
}

export function changeCustomerStatus(
  token: string,
  id: string,
  body: { status: string; lostReason?: string; expectedUpdatedAt: string },
  deps?: BackendDeps,
) {
  return callBackend<Customer>(
    path(id, '/status'),
    { method: 'POST', body, accessToken: token },
    deps,
  );
}

export function assignCustomer(
  token: string,
  id: string,
  body: { agentId: string; expectedUpdatedAt: string },
  deps?: BackendDeps,
) {
  return callBackend<Customer>(
    path(id, '/assign'),
    { method: 'POST', body, accessToken: token },
    deps,
  );
}

export function addNote(token: string, id: string, content: string, deps?: BackendDeps) {
  return callBackend<CustomerActivity>(
    path(id, '/notes'),
    { method: 'POST', body: { content }, accessToken: token },
    deps,
  );
}

export function deleteCustomer(token: string, id: string, deps?: BackendDeps) {
  return callBackend<null>(path(id), { method: 'DELETE', accessToken: token }, deps);
}

export interface CustomerFormValues {
  fullName: string;
  phone: string;
  email: string;
  purpose: string;
  purchaseTimeline: string;
  source: string;
  notes: string;
}

export interface CustomerPayload {
  fullName: string;
  phone: string;
  email: string | null;
  purpose: string | null;
  purchaseTimeline: string | null;
  source: string | null;
  notes: string | null;
}

export interface CustomerFormState {
  error: string | null;
  fieldErrors: Record<string, string>;
  values: CustomerFormValues;
}

const FIELDS = [
  'fullName',
  'phone',
  'email',
  'purpose',
  'purchaseTimeline',
  'source',
  'notes',
] as const satisfies readonly (keyof CustomerFormValues)[];

export function emptyCustomerForm(): CustomerFormValues {
  return {
    fullName: '',
    phone: '',
    email: '',
    purpose: '',
    purchaseTimeline: '',
    source: '',
    notes: '',
  };
}

export function readCustomerForm(formData: FormData): CustomerFormValues {
  const values = emptyCustomerForm();
  for (const field of FIELDS) {
    const value = formData.get(field);
    values[field] = typeof value === 'string' ? value.trim() : '';
  }
  return values;
}

export function customerFormValues(customer: Customer): CustomerFormValues {
  return {
    fullName: customer.fullName,
    phone: customer.phone,
    email: customer.email ?? '',
    purpose: customer.purpose ?? '',
    purchaseTimeline: customer.purchaseTimeline ?? '',
    source: customer.source ?? '',
    notes: customer.notes ?? '',
  };
}

/**
 * SĐT người dùng gõ → dạng quốc tế backend lưu: bỏ dấu cách, chấm, gạch; "0901…" thành "+84901…".
 * Không đoán được thì trả nguyên để backend báo lỗi đúng trường.
 */
export function normalizePhone(input: string): string {
  const compact = input.replace(/[\s.\-()]/g, '');
  if (/^0\d{8,14}$/.test(compact)) {
    return `+84${compact.slice(1)}`;
  }
  if (/^84\d{8,13}$/.test(compact)) {
    return `+${compact}`;
  }
  return compact;
}

export function validateCustomerForm(values: CustomerFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!values.fullName) {
    errors['fullName'] = 'Vui lòng nhập họ tên';
  }
  if (!/^\+\d{8,15}$/.test(normalizePhone(values.phone))) {
    errors['phone'] = 'Số điện thoại chưa đúng, vd 0901234567 hoặc +84901234567';
  }
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    errors['email'] = 'Email chưa đúng';
  }
  return errors;
}

/** Body gửi backend; ô trống thành `null` (khi sửa nghĩa là xoá giá trị). */
export function customerPayload(values: CustomerFormValues): CustomerPayload {
  return {
    fullName: values.fullName,
    phone: normalizePhone(values.phone),
    email: values.email || null,
    purpose: values.purpose || null,
    purchaseTimeline: values.purchaseTimeline || null,
    source: values.source || null,
    notes: values.notes || null,
  };
}

function range(min: number | null, max: number | null, format: (value: number) => string): string {
  if (min !== null && max !== null) {
    return `${format(min)} – ${format(max)}`;
  }
  if (min !== null) {
    return `từ ${format(min)}`;
  }
  return max !== null ? `đến ${format(max)}` : '';
}

/**
 * Một dòng tóm tắt nhu cầu: "Mua · Căn hộ, Đất nền · 2 tỷ – 3,5 tỷ · từ 60 m² · từ 2 PN · Khánh Hoà".
 * `provinceNames` tra tên tỉnh; tỉnh không có trong bảng thì bỏ qua.
 */
export function preferenceSummary(
  preference: CustomerPreference,
  provinceNames: Map<string, string>,
): string {
  const parts = [
    TRANSACTION_LABELS[preference.transactionType] ?? preference.transactionType,
    (preference.propertyTypes ?? [])
      .map((type) => (PROPERTY_TYPE_LABELS as Record<string, string>)[type] ?? type)
      .join(', '),
    range(preference.budgetMin, preference.budgetMax, formatPrice),
    range(preference.areaMin, preference.areaMax, formatArea),
    preference.bedroomsMin !== null ? `từ ${preference.bedroomsMin} PN` : '',
    (preference.provinceIds ?? [])
      .map((id) => provinceNames.get(id))
      .filter(Boolean)
      .join(', '),
  ];
  return parts.filter(Boolean).join(' · ');
}
