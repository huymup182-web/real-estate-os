import { type BackendDeps, type BackendResult, callBackend } from '../backend.ts';
import type { TokenPair } from './session-cookies.ts';

export interface LoginInput {
  identifier: string;
  password: string;
}

/** `GET /auth/me` (TASK-044): user, công ty, role và permission hiệu lực. */
export interface CurrentUser {
  user: {
    id: string;
    tenantId: string | null;
    fullName: string;
    email: string | null;
    phone: string | null;
    avatarUrl: string | null;
    departmentId: string | null;
    status: string;
  };
  company: { id: string; name: string; slug: string } | null;
  roles: { code: string; name: string }[];
  permissions: { code: string; scope: string }[];
}

/** `POST /auth/login`. Chỉ giữ cặp token, thông tin user lấy lại ở `GET /auth/me`. */
export async function loginWithBackend(
  input: LoginInput,
  userAgent: string | null,
  deps?: BackendDeps,
): Promise<BackendResult<TokenPair>> {
  return callBackend<TokenPair>('/auth/login', { method: 'POST', body: input, userAgent }, deps);
}

/** Giữ kết quả refresh trong ít giây để các request song song dùng chung một lần xoay vòng token. */
export const REFRESH_REUSE_MS = 10_000;

const refreshes = new Map<string, Promise<BackendResult<TokenPair>>>();

/**
 * `POST /auth/refresh`. Backend xoay vòng refresh token và coi việc dùng lại token cũ là bị đánh cắp
 * (thu hồi cả phiên), nên mọi request đến cùng lúc với cùng một refresh token phải chờ chung một lần gọi.
 */
export function refreshWithBackend(
  refreshToken: string,
  userAgent: string | null,
  deps?: BackendDeps,
): Promise<BackendResult<TokenPair>> {
  const pending = refreshes.get(refreshToken);
  if (pending) {
    return pending;
  }
  const promise = callBackend<TokenPair>(
    '/auth/refresh',
    { method: 'POST', body: { refreshToken }, userAgent },
    deps,
  );
  refreshes.set(refreshToken, promise);
  const forget = (): void => {
    setTimeout(() => refreshes.delete(refreshToken), REFRESH_REUSE_MS).unref();
  };
  promise.then(forget, forget);
  return promise;
}

/** `POST /auth/logout`: thu hồi phiên của access token này. */
export async function logoutWithBackend(
  accessToken: string,
  deps?: BackendDeps,
): Promise<BackendResult<null>> {
  return callBackend<null>('/auth/logout', { method: 'POST', accessToken }, deps);
}

export async function currentUser(
  accessToken: string,
  deps?: BackendDeps,
): Promise<BackendResult<CurrentUser>> {
  return callBackend<CurrentUser>('/auth/me', { accessToken }, deps);
}
