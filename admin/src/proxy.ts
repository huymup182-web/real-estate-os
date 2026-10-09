// `.js`: gói next không khai báo `exports`, nên test chạy bằng Node (ESM) cần đường dẫn file đầy đủ.
import { type NextRequest, NextResponse } from 'next/server.js';

import { refreshWithBackend } from './lib/auth/auth-api.ts';
import { LOGIN_PATH, loginPathFor } from './lib/auth/paths.ts';
import {
  ACCESS_COOKIE,
  clearedSessionCookies,
  REFRESH_COOKIE,
  sessionCookies,
} from './lib/auth/session-cookies.ts';

/**
 * Chặn mọi trang khi chưa đăng nhập (TASK-101). Còn access token → cho qua. Hết access token nhưng còn
 * refresh token → làm mới phiên, đặt cookie mới cho cả request đang xử lý lẫn trình duyệt. Không có phiên
 * hoặc refresh bị từ chối → xoá cookie, chuyển tới trang đăng nhập kèm `next`.
 *
 * Đây chỉ là lớp chặn sớm: mọi API backend vẫn tự kiểm token và quyền.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  if (pathname === LOGIN_PATH || request.cookies.has(ACCESS_COOKIE)) {
    return NextResponse.next();
  }

  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    const result = await refreshWithBackend(refreshToken, request.headers.get('user-agent'));
    if (result.ok) {
      const cookies = sessionCookies(result.data);
      for (const cookie of cookies) {
        request.cookies.set(cookie.name, cookie.value);
      }
      const response = NextResponse.next({ request: { headers: request.headers } });
      for (const cookie of cookies) {
        response.cookies.set(cookie.name, cookie.value, cookie.options);
      }
      return response;
    }
    // Backend không trả lời được: giữ phiên, để trang tự báo lỗi kết nối thay vì đăng xuất người dùng.
    if (result.status === 0 || result.status >= 500) {
      return NextResponse.next();
    }
  }

  const response = NextResponse.redirect(
    new URL(loginPathFor(`${pathname}${search}`), request.url),
  );
  if (refreshToken) {
    for (const cookie of clearedSessionCookies()) {
      response.cookies.set(cookie.name, cookie.value, cookie.options);
    }
  }
  return response;
}

export const config = {
  // Bỏ qua file tĩnh và ảnh tối ưu của Next.js.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
