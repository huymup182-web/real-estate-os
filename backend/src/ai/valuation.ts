/**
 * Phần tính toán của định giá AI (TASK-149), tách riêng để test. Giá gốc lấy từ giá/m² của các BĐS tương tự,
 * AI chỉ được chỉnh trong giới hạn VALUATION_MAX_ADJUSTMENT.
 */

/** Cần ít nhất chừng này BĐS tương tự mới định giá. */
export const VALUATION_MIN_COMPARABLES = 3;
/** Lấy tối đa chừng này BĐS tương tự. */
export const VALUATION_MAX_COMPARABLES = 10;
/** BĐS tương tự đăng trong chừng này tháng gần nhất. */
export const VALUATION_MONTHS = 24;
/** BĐS tương tự có diện tích từ 0,5 đến 2 lần BĐS cần định giá. */
export const VALUATION_AREA_RATIO = 2;
/** Khác phường thì phải cách BĐS cần định giá không quá chừng này mét (cả hai có toạ độ). */
export const VALUATION_RADIUS_M = 2000;
/** AI được chỉnh giá gốc tối đa ±10% (Huy Lê chọn ngày 2026-10-10). */
export const VALUATION_MAX_ADJUSTMENT = 10;

export type ValuationConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ValuationBase {
  /** Giá/m² trung vị của BĐS tương tự (đồng/m²). */
  pricePerM2: number;
  /** pricePerM2 × diện tích. */
  price: number;
  /** Phân vị 25 và 75 của giá/m² × diện tích. */
  low: number;
  high: number;
  /** (p75 − p25) / trung vị: độ phân tán giá/m². */
  spread: number;
}

/** Phân vị [p] (0..1) của dãy đã sắp tăng dần, nội suy tuyến tính (như percentile_cont của Postgres). */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    throw new Error('percentile của dãy rỗng');
  }
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] as number;
  const high = sorted[upper] as number;
  return low + (high - low) * (position - lower);
}

/** Giá gốc từ giá/m² của BĐS tương tự và diện tích BĐS cần định giá. */
export function valuationBase(pricesPerM2: readonly number[], area: number): ValuationBase {
  const sorted = [...pricesPerM2].sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  const p25 = percentile(sorted, 0.25);
  const p75 = percentile(sorted, 0.75);
  return {
    pricePerM2: median,
    price: median * area,
    low: p25 * area,
    high: p75 * area,
    spread: median > 0 ? (p75 - p25) / median : Infinity,
  };
}

/** Độ tin cậy: nhiều BĐS tương tự và giá/m² ít phân tán thì cao. */
export function valuationConfidence(count: number, spread: number): ValuationConfidence {
  if (count >= 8 && spread <= 0.25) {
    return 'HIGH';
  }
  if (count >= 5 && spread <= 0.5) {
    return 'MEDIUM';
  }
  return 'LOW';
}

/** Mức AI chỉnh (%) kẹp trong ±[max], làm tròn 1 chữ số thập phân; không phải số → 0. */
export function clampAdjustment(value: unknown, max = VALUATION_MAX_ADJUSTMENT): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  const clamped = Math.min(Math.max(value, -max), max);
  return Math.round(clamped * 10) / 10 || 0;
}

/** Làm tròn tới triệu đồng. */
export function roundMillion(value: number): number {
  return Math.round(value / 1_000_000) * 1_000_000;
}

/** Chênh lệch (%) của giá chào bán so với giá ước tính, 1 chữ số thập phân. */
export function differencePercent(asking: number, estimate: number): number | null {
  return estimate > 0 ? Math.round(((asking - estimate) / estimate) * 1000) / 10 : null;
}
