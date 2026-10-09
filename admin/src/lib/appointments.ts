import { type BackendDeps, type BackendResult, callBackend } from './backend.ts';

/** Giá trị khớp backend `src/appointments/appointment-values.ts`. */
export const APPOINTMENT_STATUS_LABELS = {
  SCHEDULED: 'Đã hẹn',
  COMPLETED: 'Đã xem',
  CANCELLED: 'Đã huỷ',
  NO_SHOW: 'Khách không đến',
} as const;
export type AppointmentStatus = keyof typeof APPOINTMENT_STATUS_LABELS;

export const OUTCOME_LABELS: Record<string, string> = {
  INTERESTED: 'Quan tâm',
  NOT_INTERESTED: 'Không quan tâm',
  NEED_FOLLOW_UP: 'Cần chăm sóc thêm',
  NEGOTIATING: 'Đang thương lượng',
};

/** `GET /appointments`, `GET /appointments/:id`. */
export interface Appointment {
  id: string;
  customer: { id: string; fullName: string };
  property: { id: string; code: string; title: string };
  agentId: string;
  scheduledAt: string;
  durationMinutes: number | null;
  location: string | null;
  notes: string | null;
  status: AppointmentStatus;
  outcome: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Giờ Việt Nam (UTC+7, không đổi giờ mùa hè): ngày giờ trên form luôn hiểu theo giờ này. */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** Ngày `YYYY-MM-DD` theo giờ Việt Nam của thời điểm `at`. */
export function vnDate(at: Date): string {
  return new Date(at.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Thời điểm ISO → giá trị ô `datetime-local` (`YYYY-MM-DDTHH:mm`) theo giờ Việt Nam. */
export function toLocalInput(iso: string): string {
  return new Date(new Date(iso).getTime() + VN_OFFSET_MS).toISOString().slice(0, 16);
}

/** Giá trị ô `datetime-local` (giờ Việt Nam) → ISO; sai dạng hoặc ngày không có thật → null. */
export function fromLocalInput(value: string): string | null {
  if (!DATE_TIME.test(value)) {
    return null;
  }
  const at = new Date(`${value}:00+07:00`);
  return Number.isNaN(at.getTime()) || toLocalInput(at.toISOString()) !== value
    ? null
    : at.toISOString();
}

function validDate(value: string): boolean {
  return DATE.test(value) && fromLocalInput(`${value}T00:00`) !== null;
}

export const APPOINTMENT_PAGE_SIZE = 20;

type SearchParams = Record<string, string | string[] | undefined>;

export interface AppointmentFilters {
  /** Từ ngày (gồm), `YYYY-MM-DD`; rỗng = không giới hạn. */
  from: string;
  /** Đến ngày (gồm), `YYYY-MM-DD`; rỗng = không giới hạn. */
  to: string;
  status: AppointmentStatus | '';
  customerId: string;
  page: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function single(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Bộ lọc danh sách từ query của trang. Mở trang lần đầu (không có `from`) thì xem từ hôm nay; xoá ô "Từ
 * ngày" rồi lọc thì xem cả lịch cũ. Giá trị sai thì bỏ qua thay vì để backend báo lỗi.
 */
export function appointmentFilters(params: SearchParams, now = new Date()): AppointmentFilters {
  const from = params['from'] === undefined ? vnDate(now) : single(params['from']);
  const to = single(params['to']);
  const status = single(params['status']);
  const customerId = single(params['customerId']);
  const page = Number(single(params['page']));
  const validFrom = validDate(from) ? from : '';
  return {
    from: validFrom,
    to: validDate(to) && (!validFrom || to >= validFrom) ? to : '',
    status: Object.hasOwn(APPOINTMENT_STATUS_LABELS, status) ? (status as AppointmentStatus) : '',
    customerId: UUID.test(customerId) ? customerId : '',
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/** Query của trang danh sách (giữ `from=` rỗng để không quay về mặc định hôm nay). */
export function appointmentQuery(filters: AppointmentFilters, page = filters.page): string {
  const query = new URLSearchParams();
  query.set('from', filters.from);
  for (const key of ['to', 'status', 'customerId'] as const) {
    if (filters[key]) {
      query.set(key, filters[key]);
    }
  }
  if (page > 1) {
    query.set('page', String(page));
  }
  return `?${query.toString()}`;
}

/** Query gửi backend: ngày → mốc giờ Việt Nam, `to` gồm cả ngày cuối nên gửi 0 giờ ngày hôm sau. */
export function appointmentApiQuery(filters: AppointmentFilters): string {
  const query = new URLSearchParams();
  if (filters.from) {
    query.set('from', `${filters.from}T00:00:00+07:00`);
  }
  if (filters.to) {
    const next = new Date(Date.parse(`${filters.to}T00:00:00Z`) + 24 * 60 * 60 * 1000);
    query.set('to', `${next.toISOString().slice(0, 10)}T00:00:00+07:00`);
  }
  if (filters.status) {
    query.set('status', filters.status);
  }
  if (filters.customerId) {
    query.set('customerId', filters.customerId);
  }
  query.set('page', String(filters.page));
  query.set('pageSize', String(APPOINTMENT_PAGE_SIZE));
  return query.toString();
}

export function listAppointments(
  token: string,
  filters: AppointmentFilters,
  deps?: BackendDeps,
): Promise<BackendResult<Appointment[]>> {
  return callBackend<Appointment[]>(
    `/appointments?${appointmentApiQuery(filters)}`,
    { accessToken: token },
    deps,
  );
}

const path = (id: string, suffix = ''): string =>
  `/appointments/${encodeURIComponent(id)}${suffix}`;

export function getAppointment(token: string, id: string, deps?: BackendDeps) {
  return callBackend<Appointment>(path(id), { accessToken: token }, deps);
}

export function createAppointment(
  token: string,
  body: CreateAppointmentPayload,
  deps?: BackendDeps,
) {
  return callBackend<Appointment>(
    '/appointments',
    { method: 'POST', body, accessToken: token },
    deps,
  );
}

export function updateAppointment(
  token: string,
  id: string,
  body: UpdateAppointmentPayload & { expectedUpdatedAt: string },
  deps?: BackendDeps,
) {
  return callBackend<Appointment>(path(id), { method: 'PATCH', body, accessToken: token }, deps);
}

export function changeAppointmentStatus(
  token: string,
  id: string,
  body: { status: string; outcome?: string; expectedUpdatedAt: string },
  deps?: BackendDeps,
) {
  return callBackend<Appointment>(
    path(id, '/status'),
    { method: 'POST', body, accessToken: token },
    deps,
  );
}

export function deleteAppointment(token: string, id: string, deps?: BackendDeps) {
  return callBackend<null>(path(id), { method: 'DELETE', accessToken: token }, deps);
}

/** Khách cho ô chọn khi đặt lịch: 100 khách mới nhất trong phạm vi xem. */
export function customerOptions(token: string, deps?: BackendDeps) {
  return callBackend<{ id: string; fullName: string; phone: string }[]>(
    '/customers?pageSize=100',
    { accessToken: token },
    deps,
  );
}

/** BĐS cho ô chọn khi đặt lịch: 100 BĐS mới nhất trong phạm vi xem. */
export function propertyOptions(token: string, deps?: BackendDeps) {
  return callBackend<{ id: string; code: string; title: string }[]>(
    '/properties?pageSize=100',
    { accessToken: token },
    deps,
  );
}

export interface AppointmentFormValues {
  customerId: string;
  propertyId: string;
  scheduledAt: string;
  durationMinutes: string;
  location: string;
  notes: string;
}

export interface CreateAppointmentPayload {
  customerId: string;
  propertyId: string;
  scheduledAt: string;
  durationMinutes?: number;
  location?: string;
  notes?: string;
}

export interface UpdateAppointmentPayload {
  propertyId: string;
  scheduledAt: string;
  durationMinutes: number | null;
  location: string | null;
  notes: string | null;
}

export interface AppointmentFormState {
  error: string | null;
  fieldErrors: Record<string, string>;
  values: AppointmentFormValues;
}

const FIELDS = [
  'customerId',
  'propertyId',
  'scheduledAt',
  'durationMinutes',
  'location',
  'notes',
] as const satisfies readonly (keyof AppointmentFormValues)[];

export function emptyAppointmentForm(customerId = ''): AppointmentFormValues {
  return {
    customerId,
    propertyId: '',
    scheduledAt: '',
    durationMinutes: '60',
    location: '',
    notes: '',
  };
}

export function readAppointmentForm(formData: FormData): AppointmentFormValues {
  const values = emptyAppointmentForm();
  for (const field of FIELDS) {
    const value = formData.get(field);
    values[field] = typeof value === 'string' ? value.trim() : '';
  }
  return values;
}

export function appointmentFormValues(appointment: Appointment): AppointmentFormValues {
  return {
    customerId: appointment.customer.id,
    propertyId: appointment.property.id,
    scheduledAt: toLocalInput(appointment.scheduledAt),
    durationMinutes:
      appointment.durationMinutes === null ? '' : String(appointment.durationMinutes),
    location: appointment.location ?? '',
    notes: appointment.notes ?? '',
  };
}

/** Kiểm form; `requireCustomer = false` khi sửa (không đổi khách của lịch). */
export function validateAppointmentForm(
  values: AppointmentFormValues,
  requireCustomer = true,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (requireCustomer && !UUID.test(values.customerId)) {
    errors['customerId'] = 'Vui lòng chọn khách';
  }
  if (!UUID.test(values.propertyId)) {
    errors['propertyId'] = 'Vui lòng chọn BĐS';
  }
  if (!fromLocalInput(values.scheduledAt)) {
    errors['scheduledAt'] = 'Vui lòng chọn ngày giờ hẹn';
  }
  if (values.durationMinutes) {
    const minutes = Number(values.durationMinutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 24 * 60) {
      errors['durationMinutes'] = 'Thời lượng từ 1 đến 1440 phút';
    }
  }
  return errors;
}

/** Body tạo lịch; ô tuỳ chọn để trống thì không gửi. Gọi sau `validateAppointmentForm`. */
export function createAppointmentPayload(values: AppointmentFormValues): CreateAppointmentPayload {
  return {
    customerId: values.customerId,
    propertyId: values.propertyId,
    scheduledAt: fromLocalInput(values.scheduledAt) ?? '',
    ...(values.durationMinutes ? { durationMinutes: Number(values.durationMinutes) } : {}),
    ...(values.location ? { location: values.location } : {}),
    ...(values.notes ? { notes: values.notes } : {}),
  };
}

/**
 * Body sửa lịch; ô trống thành `null` (xoá giá trị). Giờ hẹn không đổi thì gửi lại đúng mốc cũ
 * `originalScheduledAt` (ô chỉ có tới phút, tránh làm lệch giây của lịch cũ).
 */
export function updateAppointmentPayload(
  values: AppointmentFormValues,
  originalScheduledAt: string,
): UpdateAppointmentPayload {
  const unchanged = toLocalInput(originalScheduledAt) === values.scheduledAt;
  return {
    propertyId: values.propertyId,
    scheduledAt: unchanged ? originalScheduledAt : (fromLocalInput(values.scheduledAt) ?? ''),
    durationMinutes: values.durationMinutes ? Number(values.durationMinutes) : null,
    location: values.location || null,
    notes: values.notes || null,
  };
}
