import { type BackendDeps, callBackend } from './backend.ts';

/** Độ dài tối đa từng trường, khớp với backend (`CRASH_REPORT_LIMITS`, TASK-159). */
export const CRASH_REPORT_LIMITS = {
  name: 200,
  message: 2000,
  stack: 20_000,
  route: 300,
  digest: 100,
} as const;

/** Thời gian chờ khi gửi báo cáo; ngắn để không giữ request lỗi lâu. */
export const CRASH_REPORT_TIMEOUT_MS = 3_000;

/** Số báo cáo tối đa mỗi lần mở trang, để một lỗi lặp lại không gửi liên tục. */
export const CRASH_REPORTS_PER_PAGE = 10;

/** Body `POST /crash-reports` (docs/crash-reporting.md). */
export interface CrashReport {
  platform: 'admin';
  name: string;
  message: string;
  stack?: string;
  route?: string;
  appVersion?: string;
  digest?: string;
  fatal?: boolean;
}

/** Thông tin client gửi lên server action (chuỗi do trình duyệt gửi, chưa tin được). */
export interface CrashInput {
  name?: unknown;
  message?: unknown;
  stack?: unknown;
  route?: unknown;
  digest?: unknown;
  fatal?: unknown;
}

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APP_VERSION = /^[\w.+-]{1,50}$/;

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/**
 * Đường dẫn trang để nhóm lỗi: bỏ query và hash (có thể chứa từ khoá tìm kiếm, số điện thoại), đổi id thành
 * `[id]` như tên route của Next.js. Không phải đường dẫn thì bỏ.
 */
export function crashRoute(path: unknown): string | undefined {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    return undefined;
  }
  const route = (path.split(/[?#]/)[0] ?? '')
    .split('/')
    .map((segment) => (UUID_SEGMENT.test(segment) || /^\d+$/.test(segment) ? '[id]' : segment))
    .join('/')
    .replace(/\s/g, '');
  return route.slice(0, CRASH_REPORT_LIMITS.route);
}

/** Dựng báo cáo hợp lệ từ dữ liệu bất kỳ: cắt độ dài, bỏ trường sai kiểu, gắn phiên bản (`APP_VERSION`). */
export function buildCrashReport(
  input: CrashInput,
  env: Record<string, string | undefined> = process.env,
): CrashReport {
  const report: CrashReport = {
    platform: 'admin',
    name: text(input.name, CRASH_REPORT_LIMITS.name) || 'Error',
    message: text(input.message, CRASH_REPORT_LIMITS.message),
  };
  const stack = text(input.stack, CRASH_REPORT_LIMITS.stack);
  if (stack) {
    report.stack = stack;
  }
  const route = crashRoute(input.route);
  if (route) {
    report.route = route;
  }
  const digest = text(input.digest, CRASH_REPORT_LIMITS.digest);
  if (digest) {
    report.digest = digest;
  }
  const version = env['APP_VERSION'];
  if (version && APP_VERSION.test(version)) {
    report.appVersion = version;
  }
  if (input.fatal === true) {
    report.fatal = true;
  }
  return report;
}

/** Đổi lỗi bất kỳ (Error, chuỗi, object) thành các trường của báo cáo. */
export function errorFields(error: unknown): Pick<CrashInput, 'name' | 'message' | 'stack'> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { name: 'Error', message: typeof error === 'string' ? error : String(error) };
}

/** Gửi báo cáo lỗi về backend. Không bao giờ ném lỗi: báo cáo hỏng không được làm hỏng thêm trang. */
export async function sendCrashReport(
  report: CrashReport,
  accessToken: string | undefined,
  deps: BackendDeps = {},
): Promise<boolean> {
  try {
    const result = await callBackend(
      '/crash-reports',
      { method: 'POST', body: report, accessToken, timeoutMs: CRASH_REPORT_TIMEOUT_MS },
      deps,
    );
    return result.ok;
  } catch {
    return false;
  }
}

/**
 * Bộ chặn báo cáo trùng ở trình duyệt: mỗi lỗi (loại + câu lỗi) chỉ gửi một lần, tối đa [max] báo cáo mỗi lần
 * mở trang. Trả true nếu được gửi.
 */
export function crashThrottle(max: number = CRASH_REPORTS_PER_PAGE): (key: string) => boolean {
  const seen = new Set<string>();
  return (key) => {
    if (seen.has(key) || seen.size >= max) {
      return false;
    }
    seen.add(key);
    return true;
  };
}
