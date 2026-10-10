/**
 * Chấm độ giống giữa hai BĐS để cảnh báo nghi trùng (TASK-144, MASTER_PLAN mục 9). Chỉ cảnh báo, không tự
 * xoá; admin quyết định. So vị trí (phường/xã), toạ độ, giá, diện tích, SĐT chủ nhà, địa chỉ, mô tả. Ảnh chưa
 * so (PRD: duplicate bằng ảnh để sau MVP).
 */

/** Từ độ giống này trở lên thì báo nghi trùng (Huy Lê chọn ngày 2026-10-10). */
export const DUPLICATE_THRESHOLD = 70;

/** Chỉ xét BĐS cùng phường/xã hoặc cách nhau tối đa chừng này mét. */
export const DUPLICATE_RADIUS_M = 300;

export type DuplicateSignal =
  'ward' | 'coordinates' | 'price' | 'area' | 'phone' | 'address' | 'description';

/** Trọng số mỗi tiêu chí (tổng 100). Tiêu chí thiếu dữ liệu ở một trong hai BĐS thì không tính. */
export const DUPLICATE_WEIGHTS: Readonly<Record<DuplicateSignal, number>> = {
  ward: 10,
  coordinates: 15,
  price: 15,
  area: 15,
  phone: 20,
  address: 15,
  description: 10,
};

/** Dữ liệu một BĐS dùng để so. */
export interface DuplicateSubject {
  wardId: string;
  price: number;
  area: number;
  streetAddress: string | null;
  description: string | null;
  ownerPhone: string | null;
}

export interface DuplicateCandidate extends DuplicateSubject {
  /** Khoảng cách tới BĐS đang xét (mét); null khi một trong hai không có toạ độ. */
  distanceM: number | null;
}

export interface DuplicateScore {
  /** 0–100. */
  similarity: number;
  /** Lý do giống, tiếng Việt, theo thứ tự tiêu chí. */
  reasons: string[];
}

/** Chuỗi không dấu, chữ thường, chỉ chữ số cách nhau một khoảng trắng (đ → d, như `immutable_unaccent`). */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '')
    .join(' ');
}

function trigrams(text: string): Set<string> {
  const result = new Set<string>();
  for (const word of normalizeText(text).split(' ')) {
    if (word === '') {
      continue;
    }
    // Như pg_trgm: thêm hai khoảng trắng đầu, một khoảng trắng cuối mỗi từ.
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) {
      result.add(padded.slice(i, i + 3));
    }
  }
  return result;
}

/** Độ giống hai đoạn chữ theo trigram (giống `similarity()` của pg_trgm), 0–1. */
export function textSimilarity(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const gram of left) {
    if (right.has(gram)) {
      shared += 1;
    }
  }
  return shared / (left.size + right.size - shared);
}

/** Lệch tương đối giữa hai số dương: |a − b| / max(a, b). */
function relativeGap(a: number, b: number): number {
  const larger = Math.max(Math.abs(a), Math.abs(b));
  return larger === 0 ? 0 : Math.abs(a - b) / larger;
}

/** Lệch ≤ 2% → 1, ≤ 5% → 0,7, ≤ 10% → 0,4, xa hơn → 0. */
function closeness(gap: number): number {
  if (gap <= 0.02) {
    return 1;
  }
  if (gap <= 0.05) {
    return 0.7;
  }
  return gap <= 0.1 ? 0.4 : 0;
}

function distanceScore(meters: number): number {
  if (meters <= 30) {
    return 1;
  }
  if (meters <= 100) {
    return 0.7;
  }
  return meters <= DUPLICATE_RADIUS_M ? 0.3 : 0;
}

/** Độ giống chữ dưới 0,4 coi như khác. */
function textScore(similarity: number): number {
  return similarity >= 0.4 ? similarity : 0;
}

function percent(ratio: number): number {
  return Math.round(ratio * 100);
}

function gapReason(label: string, gap: number): string {
  const value = percent(gap);
  return value === 0
    ? `Cùng ${label}`
    : `${label[0]?.toUpperCase()}${label.slice(1)} lệch ${value}%`;
}

function present(text: string | null): text is string {
  return text !== null && normalizeText(text) !== '';
}

/**
 * Độ giống của [candidate] với [subject]: tổng điểm các tiêu chí có dữ liệu ở cả hai BĐS chia cho tổng trọng số
 * của chúng. Giá, diện tích, phường/xã luôn có.
 */
export function scoreDuplicate(
  subject: DuplicateSubject,
  candidate: DuplicateCandidate,
): DuplicateScore {
  let earned = 0;
  let possible = 0;
  const reasons: string[] = [];
  const add = (signal: DuplicateSignal, ratio: number, reason: string) => {
    const weight = DUPLICATE_WEIGHTS[signal];
    possible += weight;
    earned += weight * ratio;
    if (ratio > 0) {
      reasons.push(reason);
    }
  };

  add('ward', subject.wardId === candidate.wardId ? 1 : 0, 'Cùng phường/xã');
  if (candidate.distanceM !== null) {
    add(
      'coordinates',
      distanceScore(candidate.distanceM),
      `Cách ${Math.round(candidate.distanceM)} m`,
    );
  }
  const priceGap = relativeGap(subject.price, candidate.price);
  add('price', closeness(priceGap), gapReason('giá', priceGap));
  const areaGap = relativeGap(subject.area, candidate.area);
  add('area', closeness(areaGap), gapReason('diện tích', areaGap));
  if (subject.ownerPhone && candidate.ownerPhone) {
    add('phone', subject.ownerPhone === candidate.ownerPhone ? 1 : 0, 'Cùng số điện thoại chủ nhà');
  }
  if (present(subject.streetAddress) && present(candidate.streetAddress)) {
    const similarity = textSimilarity(subject.streetAddress, candidate.streetAddress);
    add('address', textScore(similarity), `Địa chỉ giống ${percent(similarity)}%`);
  }
  if (present(subject.description) && present(candidate.description)) {
    const similarity = textSimilarity(subject.description, candidate.description);
    add('description', textScore(similarity), `Mô tả giống ${percent(similarity)}%`);
  }
  return { similarity: Math.round((earned / possible) * 100), reasons };
}
