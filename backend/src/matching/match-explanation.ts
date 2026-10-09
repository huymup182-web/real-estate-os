import type { CriterionScore, MatchCriterion } from './match-score.js';

/**
 * Lời giải thích kết quả matching (TASK-089), dựng từ điểm từng tiêu chí của `scoreMatch`, không gọi AI
 * (AI ở Phase 11). Ví dụ: "92% phù hợp vì đúng khu vực, ngân sách và số phòng ngủ; gần đúng diện tích."
 */

/** Tên tiêu chí hiển thị cho người dùng. */
export const CRITERION_LABELS: Record<MatchCriterion, string> = {
  price: 'ngân sách',
  location: 'khu vực',
  area: 'diện tích',
  bedrooms: 'số phòng ngủ',
  propertyType: 'loại BĐS',
  road: 'đường vào',
  legal: 'pháp lý',
};

export interface MatchExplanation {
  /** Một câu tiếng Việt cho người dùng. */
  summary: string;
  /** Tiêu chí đạt trọn (mức đạt 1), theo thứ tự trọng số. */
  matched: MatchCriterion[];
  /** Tiêu chí đạt một phần (0 < mức đạt < 1). */
  partial: MatchCriterion[];
  /** Tiêu chí không đạt (mức đạt 0). */
  unmatched: MatchCriterion[];
}

export function explainMatch(score: number, criteria: CriterionScore[]): MatchExplanation {
  const matched = criteria.filter((item) => item.ratio >= 1).map((item) => item.criterion);
  const partial = criteria
    .filter((item) => item.ratio > 0 && item.ratio < 1)
    .map((item) => item.criterion);
  const unmatched = criteria.filter((item) => item.ratio <= 0).map((item) => item.criterion);

  let summary = `${score}% phù hợp`;
  if (criteria.length === 0) {
    summary += ': khách chưa nêu tiêu chí cụ thể';
  } else {
    const clauses: string[] = [];
    if (partial.length > 0) {
      clauses.push(`gần đúng ${joinLabels(partial)}`);
    }
    if (unmatched.length > 0) {
      clauses.push(`chưa đúng ${joinLabels(unmatched)}`);
    }
    if (matched.length > 0) {
      summary += ` vì đúng ${joinLabels(matched)}`;
    }
    if (clauses.length > 0) {
      summary += `${matched.length > 0 ? ';' : ':'} ${clauses.join('; ')}`;
    }
  }
  return { summary: `${summary}.`, matched, partial, unmatched };
}

/** "a", "a và b", "a, b và c". */
function joinLabels(criteria: MatchCriterion[]): string {
  const labels = criteria.map((criterion) => CRITERION_LABELS[criterion]);
  const last = labels.pop();
  return labels.length === 0 ? (last ?? '') : `${labels.join(', ')} và ${last ?? ''}`;
}
