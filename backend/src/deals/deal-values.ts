/** Bước của giao dịch, khớp CHECK của `deals.stage`, theo thứ tự phễu. */
export const DEAL_STAGES = ['NEGOTIATING', 'DEPOSIT', 'CONTRACT', 'WON', 'LOST'] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

/** Bước đã đóng: chuyển vào thì ghi `closed_at`, mở lại (sang bước khác) thì xoá. */
export const CLOSED_DEAL_STAGES: readonly DealStage[] = ['WON', 'LOST'];

/**
 * Sang WON bắt buộc đã có giá chốt (`deal_price`), vì doanh thu dashboard (TASK-102) cộng từ giá này
 * (mặc định Claude chọn ở TASK-110).
 */
export const PRICE_REQUIRED_STAGES: readonly DealStage[] = ['WON'];

/** Số tiền lớn nhất nhận qua API (giữ trong số nguyên an toàn của JavaScript). */
export const MAX_AMOUNT = Number.MAX_SAFE_INTEGER;
