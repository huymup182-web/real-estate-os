import { type BackendDeps, type BackendResult, callBackend } from './backend.ts';

/** Giá trị khớp backend `src/properties/property-values.ts`; nhãn theo docs/database.md mục 4.4. */
export const PROPERTY_TYPE_LABELS = {
  HOUSE: 'Nhà phố, nhà riêng',
  APARTMENT: 'Căn hộ',
  VILLA: 'Biệt thự',
  SHOPHOUSE: 'Shophouse',
  LAND: 'Đất thổ cư',
  LAND_PLOT: 'Đất nền',
  AGRICULTURAL_LAND: 'Đất nông nghiệp, vườn',
  WAREHOUSE: 'Kho, xưởng',
  OTHER: 'Khác',
} as const;
export type PropertyType = keyof typeof PROPERTY_TYPE_LABELS;

export const LEGAL_STATUS_LABELS: Record<string, string> = {
  PRIVATE_BOOK: 'Sổ riêng',
  SHARED_BOOK: 'Sổ chung',
  PENDING_BOOK: 'Chờ cấp sổ',
  SALE_CONTRACT: 'HĐ mua bán, góp vốn',
  HANDWRITTEN: 'Giấy tay, vi bằng',
  OTHER: 'Khác',
};

export const DIRECTION_LABELS: Record<string, string> = {
  N: 'Bắc',
  S: 'Nam',
  E: 'Đông',
  W: 'Tây',
  NE: 'Đông Bắc',
  NW: 'Tây Bắc',
  SE: 'Đông Nam',
  SW: 'Tây Nam',
};

export const PROPERTY_STATUS_LABELS: Record<string, string> = {
  AVAILABLE: 'Đang bán',
  PENDING: 'Đang giao dịch',
  SOLD: 'Đã bán',
  HIDDEN: 'Đã ẩn',
  EXPIRED: 'Hết hạn',
  VERIFY_REQUIRED: 'Cần xác minh',
};

/** Trạng thái người dùng tự đặt được (TASK-054); EXPIRED, VERIFY_REQUIRED do hệ thống đặt. */
export const SETTABLE_STATUSES = ['AVAILABLE', 'PENDING', 'SOLD', 'HIDDEN'] as const;

export const VERIFICATION_LABELS: Record<string, string> = {
  UNVERIFIED: 'Chưa xác minh',
  VERIFIED: 'Đã xác minh',
  EXPIRED: 'Hết hạn xác minh',
};

export const SORT_LABELS = {
  newest: 'Mới nhất',
  price_asc: 'Giá tăng dần',
  price_desc: 'Giá giảm dần',
  area_asc: 'Diện tích tăng dần',
  area_desc: 'Diện tích giảm dần',
} as const;
export type PropertySort = keyof typeof SORT_LABELS;

/** BĐS trong danh sách và chi tiết (`GET /properties`, `GET /properties/:id`). */
export interface Property {
  id: string;
  code: string;
  title: string;
  description: string | null;
  propertyType: PropertyType;
  price: number;
  area: number;
  pricePerM2: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floors: number | null;
  direction: string | null;
  roadWidth: number | null;
  legalStatus: string | null;
  provinceId: string;
  wardId: string;
  streetAddress: string | null;
  status: string;
  agentId: string;
  verificationStatus: string;
  lastVerifiedAt: string | null;
  ownerContactVisible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PropertyDetail extends Property {
  owner: {
    id: string;
    fullName: string;
    phone: string;
    email: string | null;
    notes: string | null;
  } | null;
}

export interface PropertyImage {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  isCover: boolean;
}

export interface LocationOption {
  id: string;
  code: string;
  name: string;
}

export const PROPERTY_PAGE_SIZE = 20;

type SearchParams = Record<string, string | string[] | undefined>;

export interface PropertyFilters {
  q: string;
  propertyType: PropertyType | '';
  provinceId: string;
  sort: PropertySort | '';
  page: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function single(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Bộ lọc danh sách từ query của trang; giá trị sai thì bỏ qua thay vì để backend báo lỗi. */
export function propertyFilters(params: SearchParams): PropertyFilters {
  const propertyType = single(params['propertyType']);
  const provinceId = single(params['provinceId']);
  const sort = single(params['sort']);
  const page = Number(single(params['page']));
  return {
    q: single(params['q']).slice(0, 200),
    propertyType: propertyType in PROPERTY_TYPE_LABELS ? (propertyType as PropertyType) : '',
    provinceId: UUID.test(provinceId) ? provinceId : '',
    sort: sort in SORT_LABELS ? (sort as PropertySort) : '',
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/** Query string cho bộ lọc (bỏ giá trị rỗng và trang 1), dùng cho cả backend lẫn link phân trang. */
export function propertyQuery(filters: PropertyFilters, page = filters.page): string {
  const query = new URLSearchParams();
  for (const key of ['q', 'propertyType', 'provinceId', 'sort'] as const) {
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

export function listProperties(
  token: string,
  filters: PropertyFilters,
  deps?: BackendDeps,
): Promise<BackendResult<Property[]>> {
  const query = new URLSearchParams(propertyQuery(filters).slice(1));
  query.set('page', String(filters.page));
  query.set('pageSize', String(PROPERTY_PAGE_SIZE));
  return callBackend<Property[]>(`/properties?${query.toString()}`, { accessToken: token }, deps);
}

const path = (id: string, suffix = ''): string => `/properties/${encodeURIComponent(id)}${suffix}`;

export function getProperty(token: string, id: string, deps?: BackendDeps) {
  return callBackend<PropertyDetail>(path(id), { accessToken: token }, deps);
}

/** BĐS nghi trùng (TASK-144). Người xem không được xem BĐS đó thì `property` null, chỉ có mã. */
export interface DuplicateMatch {
  code: string;
  similarity: number;
  reasons: string[];
  property: { id: string; title: string; price: number; area: number; status: string } | null;
}

export interface DuplicateReport {
  threshold: number;
  matches: DuplicateMatch[];
}

/** BĐS nghi trùng với BĐS `id`, giống nhất trước, để admin quyết định (không tự xoá). */
export function getPropertyDuplicates(token: string, id: string, deps?: BackendDeps) {
  return callBackend<DuplicateReport>(path(id, '/duplicates'), { accessToken: token }, deps);
}

export function getPropertyImages(token: string, id: string, deps?: BackendDeps) {
  return callBackend<PropertyImage[]>(path(id, '/images'), { accessToken: token }, deps);
}

export function createProperty(token: string, body: PropertyPayload, deps?: BackendDeps) {
  return callBackend<PropertyDetail>(
    '/properties',
    { method: 'POST', body, accessToken: token },
    deps,
  );
}

export function updateProperty(
  token: string,
  id: string,
  body: PropertyPayload & { expectedUpdatedAt?: string },
  deps?: BackendDeps,
) {
  return callBackend<PropertyDetail>(path(id), { method: 'PATCH', body, accessToken: token }, deps);
}

export function changePropertyStatus(
  token: string,
  id: string,
  body: { status: string; expectedUpdatedAt?: string },
  deps?: BackendDeps,
) {
  return callBackend<PropertyDetail>(
    path(id, '/status'),
    { method: 'POST', body, accessToken: token },
    deps,
  );
}

export function verifyProperty(
  token: string,
  id: string,
  body: { expectedUpdatedAt?: string },
  deps?: BackendDeps,
) {
  return callBackend<PropertyDetail>(
    path(id, '/verify'),
    { method: 'POST', body, accessToken: token },
    deps,
  );
}

export function assignProperty(
  token: string,
  id: string,
  body: { agentId: string; expectedUpdatedAt?: string },
  deps?: BackendDeps,
) {
  return callBackend<PropertyDetail>(
    path(id, '/assign'),
    { method: 'POST', body, accessToken: token },
    deps,
  );
}

export function deleteProperty(token: string, id: string, deps?: BackendDeps) {
  return callBackend<null>(path(id), { method: 'DELETE', accessToken: token }, deps);
}

export function getProvinces(token: string, deps?: BackendDeps) {
  return callBackend<LocationOption[]>('/locations/provinces', { accessToken: token }, deps);
}

export function getWards(token: string, provinceId: string, deps?: BackendDeps) {
  return callBackend<LocationOption[]>(
    `/locations/provinces/${encodeURIComponent(provinceId)}/wards`,
    { accessToken: token },
    deps,
  );
}

/** Giá kiểu môi giới: "3,5 tỷ", "850 triệu", số nhỏ hơn thì đủ chữ số. */
export function formatPrice(price: number): string {
  const number = (value: number) =>
    new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value);
  if (price >= 1_000_000_000) {
    return `${number(price / 1_000_000_000)} tỷ`;
  }
  if (price >= 1_000_000) {
    return `${number(price / 1_000_000)} triệu`;
  }
  return `${number(price)} đ`;
}

export function formatArea(area: number): string {
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(area)} m²`;
}

/** Ô nhập của form tạo/sửa BĐS, giữ dạng chuỗi để hiện lại đúng điều người dùng gõ. */
export interface PropertyFormValues {
  title: string;
  description: string;
  propertyType: string;
  price: string;
  area: string;
  bedrooms: string;
  bathrooms: string;
  floors: string;
  direction: string;
  roadWidth: string;
  legalStatus: string;
  provinceId: string;
  wardId: string;
  streetAddress: string;
}

export interface PropertyPayload {
  title: string;
  description: string | null;
  propertyType: string;
  price: number;
  area: number;
  bedrooms: number | null;
  bathrooms: number | null;
  floors: number | null;
  direction: string | null;
  roadWidth: number | null;
  legalStatus: string | null;
  provinceId: string;
  wardId: string;
  streetAddress?: string | null;
}

export interface PropertyFormState {
  error: string | null;
  fieldErrors: Record<string, string>;
  values: PropertyFormValues;
}

export const PROPERTY_FIELDS = [
  'title',
  'description',
  'propertyType',
  'price',
  'area',
  'bedrooms',
  'bathrooms',
  'floors',
  'direction',
  'roadWidth',
  'legalStatus',
  'provinceId',
  'wardId',
  'streetAddress',
] as const satisfies readonly (keyof PropertyFormValues)[];

export function emptyPropertyForm(): PropertyFormValues {
  return Object.fromEntries(
    PROPERTY_FIELDS.map((field) => [field, '']),
  ) as unknown as PropertyFormValues;
}

export function readPropertyForm(formData: FormData): PropertyFormValues {
  const values = emptyPropertyForm();
  for (const field of PROPERTY_FIELDS) {
    const value = formData.get(field);
    values[field] = typeof value === 'string' ? value.trim() : '';
  }
  return values;
}

export function propertyFormValues(property: Property): PropertyFormValues {
  const text = (value: number | string | null): string => (value === null ? '' : String(value));
  return {
    title: property.title,
    description: property.description ?? '',
    propertyType: property.propertyType,
    price: String(property.price),
    area: String(property.area),
    bedrooms: text(property.bedrooms),
    bathrooms: text(property.bathrooms),
    floors: text(property.floors),
    direction: property.direction ?? '',
    roadWidth: text(property.roadWidth),
    legalStatus: property.legalStatus ?? '',
    provinceId: property.provinceId,
    wardId: property.wardId,
    streetAddress: property.streetAddress ?? '',
  };
}

const INTEGER = /^\d+$/;
const DECIMAL_2 = /^\d+([.,]\d{1,2})?$/;
const toNumber = (value: string): number => Number(value.replace(',', '.'));

/** Kiểm nhanh trên form; backend vẫn kiểm đầy đủ (giới hạn, địa giới…). */
export function validatePropertyForm(values: PropertyFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!values.title) {
    errors['title'] = 'Vui lòng nhập tiêu đề';
  }
  if (!(values.propertyType in PROPERTY_TYPE_LABELS)) {
    errors['propertyType'] = 'Vui lòng chọn loại BĐS';
  }
  if (!INTEGER.test(values.price)) {
    errors['price'] = 'Giá là số nguyên (đồng), không có dấu chấm phẩy';
  }
  if (!DECIMAL_2.test(values.area) || toNumber(values.area) <= 0) {
    errors['area'] = 'Diện tích là số lớn hơn 0, tối đa 2 chữ số thập phân';
  }
  for (const field of ['bedrooms', 'bathrooms', 'floors'] as const) {
    if (values[field] && !INTEGER.test(values[field])) {
      errors[field] = 'Nhập số nguyên';
    }
  }
  if (values.roadWidth && !DECIMAL_2.test(values.roadWidth)) {
    errors['roadWidth'] = 'Nhập số mét, tối đa 2 chữ số thập phân';
  }
  if (!values.provinceId) {
    errors['provinceId'] = 'Vui lòng chọn tỉnh/thành';
  }
  if (!values.wardId) {
    errors['wardId'] = 'Vui lòng chọn phường/xã';
  }
  return errors;
}

/**
 * Body gửi backend. Ô trống gửi `null` để xoá giá trị. Địa chỉ chi tiết chỉ gửi khi người dùng xem được nó
 * (`withStreetAddress`), để người không thấy địa chỉ không vô tình xoá mất.
 */
export function propertyPayload(
  values: PropertyFormValues,
  withStreetAddress: boolean,
): PropertyPayload {
  const optionalNumber = (value: string): number | null => (value ? toNumber(value) : null);
  return {
    title: values.title,
    description: values.description || null,
    propertyType: values.propertyType,
    price: Number(values.price),
    area: toNumber(values.area),
    bedrooms: optionalNumber(values.bedrooms),
    bathrooms: optionalNumber(values.bathrooms),
    floors: optionalNumber(values.floors),
    direction: values.direction || null,
    roadWidth: optionalNumber(values.roadWidth),
    legalStatus: values.legalStatus || null,
    provinceId: values.provinceId,
    wardId: values.wardId,
    ...(withStreetAddress ? { streetAddress: values.streetAddress || null } : {}),
  };
}

/** Người dùng đang hoạt động trong phạm vi `user.view`, để chọn môi giới phụ trách (tối đa 100 người). */
export function listAgentOptions(token: string, deps?: BackendDeps) {
  return callBackend<{ id: string; fullName: string; email: string | null }[]>(
    '/users?status=ACTIVE&pageSize=100',
    { accessToken: token },
    deps,
  );
}
