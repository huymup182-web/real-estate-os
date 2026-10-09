import { cookies } from 'next/headers';

import { ACCESS_COOKIE } from './session-cookies.ts';

/** Access token của request hiện tại (chỉ dùng ở phía server). Proxy đã làm mới phiên trước khi trang chạy. */
export async function accessToken(): Promise<string> {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? '';
}
