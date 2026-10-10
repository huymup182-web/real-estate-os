import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { explainMatch } from '../src/matching/match-explanation.js';
import type { CriterionScore, MatchCriterion } from '../src/matching/match-score.js';

const WEIGHTS: Record<MatchCriterion, number> = {
  price: 30,
  location: 25,
  area: 15,
  bedrooms: 10,
  propertyType: 10,
  road: 5,
  legal: 5,
};

const scores = (ratios: Partial<Record<MatchCriterion, number>>): CriterionScore[] =>
  (Object.keys(ratios) as MatchCriterion[]).map((criterion) => ({
    criterion,
    weight: WEIGHTS[criterion],
    ratio: ratios[criterion] ?? 0,
  }));

describe('explainMatch (TASK-089)', () => {
  it('ví dụ roadmap: đúng khu vực, ngân sách và số phòng ngủ', () => {
    const explanation = explainMatch(92, scores({ location: 1, price: 1, bedrooms: 1 }));
    assert.equal(explanation.summary, '92% phù hợp vì đúng khu vực, ngân sách và số phòng ngủ.');
    assert.deepEqual(explanation.matched, ['location', 'price', 'bedrooms']);
    assert.deepEqual(explanation.partial, []);
    assert.deepEqual(explanation.unmatched, []);
  });

  it('kèm tiêu chí gần đúng và chưa đúng', () => {
    const explanation = explainMatch(
      70,
      scores({ price: 0.5, location: 1, area: 1, propertyType: 0, legal: 0 }),
    );
    assert.equal(
      explanation.summary,
      '70% phù hợp vì đúng khu vực và diện tích; gần đúng ngân sách; chưa đúng loại BĐS và pháp lý.',
    );
    assert.deepEqual(explanation.partial, ['price']);
    assert.deepEqual(explanation.unmatched, ['propertyType', 'legal']);
  });

  it('không đúng tiêu chí nào trọn vẹn; một tiêu chí; khách chưa nêu gì', () => {
    assert.equal(
      explainMatch(40, scores({ price: 0.7, location: 0 })).summary,
      '40% phù hợp: gần đúng ngân sách; chưa đúng khu vực.',
    );
    assert.equal(explainMatch(100, scores({ road: 1 })).summary, '100% phù hợp vì đúng đường vào.');
    assert.equal(explainMatch(100, []).summary, '100% phù hợp: khách chưa nêu tiêu chí cụ thể.');
  });
});
