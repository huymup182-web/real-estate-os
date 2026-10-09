/** Cookie giữ access token; hết hạn sớm hơn token một chút để proxy làm mới trước khi backend báo 401. */
export const ACCESS_COOKIE = 'reos_access';
/** Cookie giữ refresh token (phase0/05-API-CONVENTIONS.md mục 7: HttpOnly, Secure, SameSite=Strict). */
export const REFRESH_COOKIE = 'reos_refresh';
/** Bằng thời hạn refresh token của backend (30 ngày). */
export const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
/** Số giây cookie access token hết hạn trước token thật. */
export const ACCESS_EXPIRY_MARGIN = 30;

/** Cặp token backend trả ở `POST /auth/login` và `POST /auth/refresh`. */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Số giây access token còn hiệu lực. */
  expiresIn: number;
}

export interface CookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax' | 'strict';
  path: '/';
  maxAge: number;
}

export interface SessionCookie {
  name: string;
  value: string;
  options: CookieOptions;
}

type Env = Record<string, string | undefined>;

/**
 * Hai cookie phiên đăng nhập. Cả hai là HttpOnly nên JavaScript trên trình duyệt không đọc được token.
 * `Secure` bật ở production (local chạy http). Access token dùng SameSite=Lax để mở link từ nơi khác
 * vẫn giữ phiên; refresh token dùng Strict như quy ước.
 */
export function sessionCookies(tokens: TokenPair, env: Env = process.env): SessionCookie[] {
  const secure = env['NODE_ENV'] === 'production';
  return [
    {
      name: ACCESS_COOKIE,
      value: tokens.accessToken,
      options: {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/',
        maxAge: Math.max(tokens.expiresIn - ACCESS_EXPIRY_MARGIN, 1),
      },
    },
    {
      name: REFRESH_COOKIE,
      value: tokens.refreshToken,
      options: {
        httpOnly: true,
        secure,
        sameSite: 'strict',
        path: '/',
        maxAge: REFRESH_COOKIE_MAX_AGE,
      },
    },
  ];
}

/** Cookie xoá phiên (giá trị rỗng, hết hạn ngay), dùng khi đăng xuất hoặc refresh thất bại. */
export function clearedSessionCookies(env: Env = process.env): SessionCookie[] {
  return sessionCookies({ accessToken: '', refreshToken: '', expiresIn: 0 }, env).map((cookie) => ({
    ...cookie,
    options: { ...cookie.options, maxAge: 0 },
  }));
}
