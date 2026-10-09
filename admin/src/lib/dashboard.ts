import { type BackendDeps, type BackendResult, callBackend } from './backend.ts';

/** `GET /reports/dashboard` (TASK-102). */
export interface Dashboard {
  period: { from: string; to: string };
  scope: string;
  properties: { total: number; new: number; active: number };
  customers: { total: number; new: number };
  viewings: number;
  deals: { new: number; won: number; revenue: number };
  agents: number;
  leadFunnel: { status: string; count: number }[];
  salesFunnel: { stage: string; count: number; value: number }[];
}

/** Các kỳ chọn nhanh trên dashboard (số ngày gần nhất). */
export const PERIOD_OPTIONS = [7, 30, 90] as const;
export const DEFAULT_PERIOD_DAYS = 30;
const DAY_MS = 24 * 3600 * 1000;

/** Số ngày từ `?days=`; giá trị ngoài danh sách chọn nhanh thì dùng mặc định 30. */
export function periodDays(raw: string | string[] | undefined): number {
  const days = Number(typeof raw === 'string' ? raw : undefined);
  return (PERIOD_OPTIONS as readonly number[]).includes(days) ? days : DEFAULT_PERIOD_DAYS;
}

export async function fetchDashboard(
  accessToken: string,
  days: number,
  now: Date = new Date(),
  deps?: BackendDeps,
): Promise<BackendResult<Dashboard>> {
  const query = new URLSearchParams({
    from: new Date(now.getTime() - days * DAY_MS).toISOString(),
    to: now.toISOString(),
  });
  return callBackend<Dashboard>(`/reports/dashboard?${query.toString()}`, { accessToken }, deps);
}

export const SCOPE_LABELS: Record<string, string> = {
  OWN: 'Của bạn',
  TEAM: 'Nhóm của bạn',
  DEPARTMENT: 'Phòng ban của bạn',
  COMPANY: 'Toàn công ty',
  PLATFORM: 'Toàn hệ thống',
};

export const CUSTOMER_STATUS_LABELS: Record<string, string> = {
  NEW: 'Mới',
  CONTACTED: 'Đã liên hệ',
  QUALIFIED: 'Đủ điều kiện',
  VIEWING: 'Đi xem',
  NEGOTIATING: 'Đàm phán',
  DEPOSIT: 'Đặt cọc',
  WON: 'Thành công',
  LOST: 'Thất bại',
};

export const DEAL_STAGE_LABELS: Record<string, string> = {
  NEGOTIATING: 'Đàm phán',
  DEPOSIT: 'Đặt cọc',
  CONTRACT: 'Hợp đồng',
  WON: 'Thành công',
  LOST: 'Thất bại',
};

const countFormat = new Intl.NumberFormat('vi-VN');
const shortFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

export function formatCount(value: number): string {
  return countFormat.format(value);
}

/** Tiền VNĐ dạng ngắn: "9 tỷ", "1,25 tỷ", "850 triệu", dưới một triệu thì ghi đủ kèm "đ". */
export function formatVnd(value: number): string {
  if (Math.abs(value) >= 1e9) {return `${shortFormat.format(value / 1e9)} tỷ`;}
  if (Math.abs(value) >= 1e6) {return `${shortFormat.format(value / 1e6)} triệu`;}
  return `${countFormat.format(value)} đ`;
}

/** Độ dài thanh phễu (phần trăm so với bước lớn nhất); có giá trị thì tối thiểu 2% để còn nhìn thấy. */
export function barWidths(counts: number[]): number[] {
  const max = Math.max(0, ...counts);
  return counts.map((count) => (max === 0 || count === 0 ? 0 : Math.max(2, (count / max) * 100)));
}
