import { fromLocalInput, vnDate } from './appointments.ts';
import { type BackendDeps, type BackendResult, callBackend } from './backend.ts';

/** Giá trị khớp backend `src/deals/deal-values.ts`, theo thứ tự phễu. */
export const DEAL_STAGE_LABELS = {
  NEGOTIATING: 'Đang thương lượng',
  DEPOSIT: 'Đã đặt cọc',
  CONTRACT: 'Đã ký hợp đồng',
  WON: 'Thành công',
  LOST: 'Thất bại',
} as const;
export type DealStage = keyof typeof DEAL_STAGE_LABELS;

/** `GET /deals`, `GET /deals/:id`. */
export interface Deal {
  id: string;
  customer: { id: string; fullName: string };
  property: { id: string; code: string; title: string };
  agentId: string;
  stage: DealStage;
  dealPrice: number | null;
  depositAmount: number | null;
  depositAt: string | null;
  closedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export const DEAL_PAGE_SIZE = 20;

type SearchParams = Record<string, string | string[] | undefined>;

export interface DealFilters {
  stage: DealStage | '';
  customerId: string;
  page: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function single(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Bộ lọc danh sách từ query của trang; giá trị sai thì bỏ qua thay vì để backend báo lỗi. */
export function dealFilters(params: SearchParams): DealFilters {
  const stage = single(params['stage']);
  const customerId = single(params['customerId']);
  const page = Number(single(params['page']));
  return {
    stage: Object.hasOwn(DEAL_STAGE_LABELS, stage) ? (stage as DealStage) : '',
    customerId: UUID.test(customerId) ? customerId : '',
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

export function dealQuery(filters: DealFilters, page = filters.page): string {
  const query = new URLSearchParams();
  for (const key of ['stage', 'customerId'] as const) {
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

export function listDeals(
  token: string,
  filters: DealFilters,
  deps?: BackendDeps,
): Promise<BackendResult<Deal[]>> {
  const query = new URLSearchParams(dealQuery(filters).slice(1));
  query.set('page', String(filters.page));
  query.set('pageSize', String(DEAL_PAGE_SIZE));
  return callBackend<Deal[]>(`/deals?${query.toString()}`, { accessToken: token }, deps);
}

const path = (id: string, suffix = ''): string => `/deals/${encodeURIComponent(id)}${suffix}`;

export function getDeal(token: string, id: string, deps?: BackendDeps) {
  return callBackend<Deal>(path(id), { accessToken: token }, deps);
}

export function createDeal(token: string, body: CreateDealPayload, deps?: BackendDeps) {
  return callBackend<Deal>('/deals', { method: 'POST', body, accessToken: token }, deps);
}

export function updateDeal(
  token: string,
  id: string,
  body: UpdateDealPayload & { expectedUpdatedAt: string },
  deps?: BackendDeps,
) {
  return callBackend<Deal>(path(id), { method: 'PATCH', body, accessToken: token }, deps);
}

export function changeDealStage(
  token: string,
  id: string,
  body: { stage: string; expectedUpdatedAt: string },
  deps?: BackendDeps,
) {
  return callBackend<Deal>(path(id, '/stage'), { method: 'POST', body, accessToken: token }, deps);
}

export function deleteDeal(token: string, id: string, deps?: BackendDeps) {
  return callBackend<null>(path(id), { method: 'DELETE', accessToken: token }, deps);
}

/**
 * Số tiền người dùng gõ (đồng) → số nguyên: bỏ dấu cách và dấu chấm phân cách nghìn ("3.500.000.000").
 * Không phải số nguyên không âm (có phần lẻ, chữ, quá lớn) → null.
 */
export function parseAmount(input: string): number | null {
  const compact = input.replace(/[\s.]/g, '');
  if (!/^\d+$/.test(compact)) {
    return null;
  }
  const value = Number(compact);
  return Number.isSafeInteger(value) ? value : null;
}

/** Số tiền hiện trên trang: "3.500.000.000 đ". */
export function formatMoney(value: number | null): string {
  return value === null ? '—' : `${new Intl.NumberFormat('vi-VN').format(value)} đ`;
}

export interface DealFormValues {
  customerId: string;
  propertyId: string;
  dealPrice: string;
  depositAmount: string;
  /** Ngày cọc `YYYY-MM-DD` theo giờ Việt Nam. */
  depositAt: string;
  notes: string;
}

export interface CreateDealPayload {
  customerId: string;
  propertyId: string;
  dealPrice?: number;
  depositAmount?: number;
  depositAt?: string;
  notes?: string;
}

export interface UpdateDealPayload {
  dealPrice: number | null;
  depositAmount: number | null;
  depositAt: string | null;
  notes: string | null;
}

export interface DealFormState {
  error: string | null;
  fieldErrors: Record<string, string>;
  values: DealFormValues;
}

const FIELDS = [
  'customerId',
  'propertyId',
  'dealPrice',
  'depositAmount',
  'depositAt',
  'notes',
] as const satisfies readonly (keyof DealFormValues)[];

export function emptyDealForm(customerId = ''): DealFormValues {
  return { customerId, propertyId: '', dealPrice: '', depositAmount: '', depositAt: '', notes: '' };
}

export function readDealForm(formData: FormData): DealFormValues {
  const values = emptyDealForm();
  for (const field of FIELDS) {
    const value = formData.get(field);
    values[field] = typeof value === 'string' ? value.trim() : '';
  }
  return values;
}

export function dealFormValues(deal: Deal): DealFormValues {
  return {
    customerId: deal.customer.id,
    propertyId: deal.property.id,
    dealPrice: deal.dealPrice === null ? '' : String(deal.dealPrice),
    depositAmount: deal.depositAmount === null ? '' : String(deal.depositAmount),
    depositAt: deal.depositAt ? vnDate(new Date(deal.depositAt)) : '',
    notes: deal.notes ?? '',
  };
}

/** Ngày `YYYY-MM-DD` (giờ Việt Nam) → ISO lúc 0 giờ; sai dạng → null. */
function dayStart(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? fromLocalInput(`${value}T00:00`) : null;
}

/** Kiểm form; `creating = false` khi sửa (không đổi khách, BĐS). */
export function validateDealForm(values: DealFormValues, creating = true): Record<string, string> {
  const errors: Record<string, string> = {};
  if (creating && !UUID.test(values.customerId)) {
    errors['customerId'] = 'Vui lòng chọn khách';
  }
  if (creating && !UUID.test(values.propertyId)) {
    errors['propertyId'] = 'Vui lòng chọn BĐS';
  }
  for (const field of ['dealPrice', 'depositAmount'] as const) {
    if (values[field] && parseAmount(values[field]) === null) {
      errors[field] = 'Nhập số tiền bằng số nguyên (đồng), vd 3500000000';
    }
  }
  if (values.depositAt && !dayStart(values.depositAt)) {
    errors['depositAt'] = 'Ngày cọc chưa đúng';
  }
  return errors;
}

/** Body tạo giao dịch; ô trống thì không gửi. Gọi sau `validateDealForm`. */
export function createDealPayload(values: DealFormValues): CreateDealPayload {
  const dealPrice = parseAmount(values.dealPrice);
  const depositAmount = parseAmount(values.depositAmount);
  const depositAt = dayStart(values.depositAt);
  return {
    customerId: values.customerId,
    propertyId: values.propertyId,
    ...(dealPrice !== null ? { dealPrice } : {}),
    ...(depositAmount !== null ? { depositAmount } : {}),
    ...(depositAt ? { depositAt } : {}),
    ...(values.notes ? { notes: values.notes } : {}),
  };
}

/**
 * Body sửa giao dịch; ô trống thành `null` (xoá giá trị). Ngày cọc không đổi thì gửi lại đúng mốc cũ
 * `originalDepositAt` (ô chỉ có ngày, tránh làm mất giờ của mốc cũ).
 */
export function updateDealPayload(
  values: DealFormValues,
  originalDepositAt: string | null,
): UpdateDealPayload {
  const unchanged =
    originalDepositAt !== null && vnDate(new Date(originalDepositAt)) === values.depositAt;
  return {
    dealPrice: parseAmount(values.dealPrice),
    depositAmount: parseAmount(values.depositAmount),
    depositAt: unchanged ? originalDepositAt : dayStart(values.depositAt),
    notes: values.notes || null,
  };
}
