/** Địa chỉ backend khi chạy local ngoài Docker (`npm run start:dev` trong backend/). */
export const DEFAULT_API_INTERNAL_URL = 'http://localhost:3000';
/** Tiền tố mọi route của Backend API (phase0/05-API-CONVENTIONS.md). */
export const API_PREFIX = '/api/v1';
/** Thời gian chờ tối đa khi admin (phía server) gọi backend. */
export const BACKEND_TIMEOUT_MS = 5_000;

/**
 * URL đầy đủ tới một route Backend API, gọi từ phía server của Next.js. Gốc lấy từ `API_INTERNAL_URL`
 * (trong Docker là `http://backend:3000`, xem docker-compose.yml).
 */
export function backendUrl(
  path: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const base = (env['API_INTERNAL_URL'] || DEFAULT_API_INTERNAL_URL).replace(/\/+$/, '');
  const route = path.startsWith('/') ? path : `/${path}`;
  return `${base}${API_PREFIX}${route}`;
}

/** Lỗi khi không gọi được backend (mạng, quá thời gian, body không đọc được). */
export const NETWORK_ERROR = 'NETWORK_ERROR';
export const NETWORK_ERROR_MESSAGE = 'Không kết nối được máy chủ, vui lòng thử lại';
/** Câu dùng khi backend trả lỗi mà body không có `message`. */
export const UNKNOWN_ERROR_MESSAGE = 'Có lỗi xảy ra, vui lòng thử lại';

/** Kết quả một lần gọi Backend API: `data` khi 2xx; `code` + `message` theo body lỗi chuẩn khi không. */
export type BackendResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; code: string; message: string };

export interface BackendDeps {
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
}

interface BackendBody {
  data?: unknown;
  message?: unknown;
  error?: { code?: unknown };
}

/**
 * Gọi một route Backend API từ phía server, gửi/nhận JSON. Lỗi mạng hoặc quá thời gian trả `status: 0`.
 * Body lỗi theo phase0/05-API-CONVENTIONS.md: `{ success: false, message, error: { code } }`.
 */
export async function callBackend<T>(
  path: string,
  init: { method?: string; body?: unknown; accessToken?: string; userAgent?: string | null } = {},
  { fetchImpl = fetch, env = process.env }: BackendDeps = {},
): Promise<BackendResult<T>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (init.accessToken) {
    headers['authorization'] = `Bearer ${init.accessToken}`;
  }
  if (init.userAgent) {
    headers['user-agent'] = init.userAgent;
  }

  let response: Response;
  let body: BackendBody | null;
  try {
    response = await fetchImpl(backendUrl(path, env), {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
    body = response.status === 204 ? null : ((await response.json()) as BackendBody | null);
  } catch {
    return { ok: false, status: 0, code: NETWORK_ERROR, message: NETWORK_ERROR_MESSAGE };
  }

  if (response.ok) {
    return { ok: true, status: response.status, data: (body?.data ?? null) as T };
  }
  const code = typeof body?.error?.code === 'string' ? body.error.code : 'INTERNAL_ERROR';
  const message =
    typeof body?.message === 'string' && body.message !== '' ? body.message : UNKNOWN_ERROR_MESSAGE;
  return { ok: false, status: response.status, code, message };
}
