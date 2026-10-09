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

export type BackendStatus = 'up' | 'down';

/** Tình trạng backend qua `GET /health`: `down` khi lỗi mạng, quá thời gian hoặc không phải 2xx. */
export async function backendStatus(
  fetchImpl: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<BackendStatus> {
  try {
    const response = await fetchImpl(backendUrl('/health', env), {
      cache: 'no-store',
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
    return response.ok ? 'up' : 'down';
  } catch {
    return 'down';
  }
}
