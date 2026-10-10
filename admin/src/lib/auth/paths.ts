/** Trang đăng nhập, route công khai duy nhất của admin. */
export const LOGIN_PATH = '/login';
export const HOME_PATH = '/';

/**
 * Đích chuyển tới sau đăng nhập, lấy từ `?next=`. Chỉ nhận đường dẫn nội bộ (bắt đầu bằng một `/`)
 * để không bị lợi dụng chuyển hướng sang trang ngoài; còn lại về trang chủ.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    return HOME_PATH;
  }
  if (/\p{Cc}/u.test(raw)) {
    return HOME_PATH;
  }
  if (raw === LOGIN_PATH || raw.startsWith(`${LOGIN_PATH}?`)) {
    return HOME_PATH;
  }
  return raw;
}

/** URL trang đăng nhập, kèm `next` để quay lại trang đang mở (bỏ qua khi là trang chủ). */
export function loginPathFor(nextPath: string): string {
  const next = safeNextPath(nextPath);
  return next === HOME_PATH ? LOGIN_PATH : `${LOGIN_PATH}?next=${encodeURIComponent(next)}`;
}
