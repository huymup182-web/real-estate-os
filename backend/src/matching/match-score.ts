import { ROAD_ACCESSES } from '../properties/property-values.js';

/**
 * Luật chấm điểm matching nhu cầu khách ↔ BĐS (TASK-086). Hàm thuần, không đọc database: TASK-087/088
 * lấy dữ liệu rồi gọi `scoreMatch`, TASK-089 dựng lời giải thích từ `criteria`.
 */

/** Trọng số theo roadmap (tổng 100). */
export const MATCH_WEIGHTS = {
  price: 30,
  location: 25,
  area: 15,
  bedrooms: 10,
  propertyType: 10,
  road: 5,
  legal: 5,
} as const;
export type MatchCriterion = keyof typeof MATCH_WEIGHTS;

/**
 * Giá, diện tích lệch ra ngoài khoảng khách muốn: điểm giảm tuyến tính, lệch từ tỉ lệ này trở lên thì 0
 * (mặc định Claude chọn ở TASK-086).
 */
export const RANGE_TOLERANCE = 0.2;

/** Thiếu đúng 1 phòng ngủ so với yêu cầu được nửa điểm (mặc định Claude chọn ở TASK-086). */
export const BEDROOMS_SHORT_BY_ONE_RATIO = 0.5;

/**
 * Tiêu chí khách không nêu: không tính, điểm chia trên tổng trọng số các tiêu chí đã nêu (mặc định Claude
 * chọn ở TASK-086, chờ Huy Lê xác nhận). Khách không nêu tiêu chí nào thì mọi BĐS cùng loại giao dịch được
 * 100%.
 */
export const SKIP_UNSTATED_CRITERIA = true;

/** Phần nhu cầu khách dùng để chấm (khớp `customer_preferences`). */
export interface MatchPreference {
  transactionType: string;
  propertyTypes: string[] | null;
  budgetMin: number | null;
  budgetMax: number | null;
  areaMin: number | null;
  areaMax: number | null;
  bedroomsMin: number | null;
  provinceIds: string[] | null;
  districtIds: string[] | null;
  wardIds: string[] | null;
  legalStatuses: string[] | null;
  minRoadAccess: string | null;
}

/** Phần BĐS dùng để chấm (khớp `properties`). */
export interface MatchProperty {
  transactionType: string;
  propertyType: string;
  price: number;
  area: number;
  bedrooms: number | null;
  provinceId: string;
  districtId: string | null;
  wardId: string;
  legalStatus: string | null;
  roadAccess: string | null;
}

export interface CriterionScore {
  criterion: MatchCriterion;
  weight: number;
  /** Mức đạt 0..1. */
  ratio: number;
}

export interface MatchScore {
  /** Khác loại giao dịch (bán/thuê) thì không khớp, `score` = 0. */
  eligible: boolean;
  /** 0..100, làm tròn. */
  score: number;
  /** Các tiêu chí khách đã nêu (hoặc mọi tiêu chí nếu không bỏ tiêu chí không nêu), theo thứ tự trọng số. */
  criteria: CriterionScore[];
}

/** Chấm mức phù hợp của một BĐS với một nhu cầu. */
export function scoreMatch(preference: MatchPreference, property: MatchProperty): MatchScore {
  if (preference.transactionType !== property.transactionType) {
    return { eligible: false, score: 0, criteria: [] };
  }
  const ratios: Record<MatchCriterion, number | null> = {
    price: rangeRatio(property.price, preference.budgetMin, preference.budgetMax),
    location: locationRatio(preference, property),
    area: rangeRatio(property.area, preference.areaMin, preference.areaMax),
    bedrooms: bedroomsRatio(property.bedrooms, preference.bedroomsMin),
    propertyType: listRatio(property.propertyType, preference.propertyTypes),
    road: roadRatio(property.roadAccess, preference.minRoadAccess),
    legal: listRatio(property.legalStatus, preference.legalStatuses),
  };
  const criteria: CriterionScore[] = [];
  for (const criterion of Object.keys(MATCH_WEIGHTS) as MatchCriterion[]) {
    const ratio = ratios[criterion];
    if (ratio === null && SKIP_UNSTATED_CRITERIA) {
      continue;
    }
    criteria.push({ criterion, weight: MATCH_WEIGHTS[criterion], ratio: ratio ?? 1 });
  }
  const totalWeight = criteria.reduce((sum, item) => sum + item.weight, 0);
  const earned = criteria.reduce((sum, item) => sum + item.weight * item.ratio, 0);
  const score = totalWeight === 0 ? 100 : Math.round((earned / totalWeight) * 100);
  return { eligible: true, score, criteria };
}

/**
 * Trong `[min, max]` → 1; ngoài khoảng giảm tuyến tính theo độ lệch so với mốc gần nhất, lệch ≥
 * `RANGE_TOLERANCE` → 0. Không nêu cả hai mốc → null (không tính).
 */
function rangeRatio(value: number, min: number | null, max: number | null): number | null {
  if (min === null && max === null) {
    return null;
  }
  let deviation = 0;
  if (max !== null && value > max) {
    deviation = max === 0 ? 1 : (value - max) / max;
  } else if (min !== null && value < min) {
    deviation = (min - value) / min;
  }
  return Math.max(0, 1 - deviation / RANGE_TOLERANCE);
}

/** BĐS nằm trong bất kỳ tỉnh, quận/huyện hoặc phường/xã khách nêu → 1, không thì 0. */
function locationRatio(preference: MatchPreference, property: MatchProperty): number | null {
  const lists = [preference.provinceIds, preference.districtIds, preference.wardIds];
  if (lists.every((list) => !list || list.length === 0)) {
    return null;
  }
  const inArea =
    (preference.provinceIds ?? []).includes(property.provinceId) ||
    (property.districtId !== null &&
      (preference.districtIds ?? []).includes(property.districtId)) ||
    (preference.wardIds ?? []).includes(property.wardId);
  return inArea ? 1 : 0;
}

/** Đủ số phòng → 1; thiếu đúng 1 → `BEDROOMS_SHORT_BY_ONE_RATIO`; thiếu hơn hoặc BĐS chưa ghi → 0. */
function bedroomsRatio(bedrooms: number | null, min: number | null): number | null {
  if (min === null || min === 0) {
    return null;
  }
  if (bedrooms === null) {
    return 0;
  }
  if (bedrooms >= min) {
    return 1;
  }
  return bedrooms === min - 1 ? BEDROOMS_SHORT_BY_ONE_RATIO : 0;
}

/** Giá trị của BĐS thuộc danh sách khách nêu → 1; không thuộc hoặc BĐS chưa ghi → 0. */
function listRatio(value: string | null, wanted: string[] | null): number | null {
  if (!wanted || wanted.length === 0) {
    return null;
  }
  return value !== null && wanted.includes(value) ? 1 : 0;
}

/**
 * Đường vào ít nhất bằng yêu cầu (ô tô > xe máy > đi bộ) → 1; kém hơn hoặc BĐS chưa ghi → 0. Khách chỉ
 * cần đi bộ thì mọi BĐS đều đạt nên coi như không nêu.
 */
function roadRatio(roadAccess: string | null, minRoadAccess: string | null): number | null {
  const required = rank(minRoadAccess);
  if (required === null || required === rank('WALK')) {
    return null;
  }
  const actual = rank(roadAccess);
  return actual !== null && actual >= required ? 1 : 0;
}

/** CAR = 2, MOTORBIKE = 1, WALK = 0. */
function rank(access: string | null): number | null {
  const index =
    access === null ? -1 : ROAD_ACCESSES.indexOf(access as (typeof ROAD_ACCESSES)[number]);
  return index === -1 ? null : ROAD_ACCESSES.length - 1 - index;
}
