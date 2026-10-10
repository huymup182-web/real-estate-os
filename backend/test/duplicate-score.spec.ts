import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type DuplicateCandidate,
  type DuplicateSubject,
  normalizeText,
  scoreDuplicate,
  textSimilarity,
} from '../src/properties/duplicate-score.js';

const subject: DuplicateSubject = {
  wardId: 'ward-vinh-hai',
  price: 5_000_000_000,
  area: 80,
  streetAddress: '12 Trần Phú',
  description: 'Nhà mới xây, gần biển, hẻm ô tô.',
  ownerPhone: '+84912345678',
};

const same: DuplicateCandidate = { ...subject, distanceM: 10 };

describe('Chấm độ giống BĐS nghi trùng (TASK-144)', () => {
  it('bỏ dấu, chữ thường, chỉ chữ và số', () => {
    assert.equal(normalizeText('  Số 12, đường Trần-Phú!  '), 'so 12 duong tran phu');
  });

  it('độ giống chữ kiểu pg_trgm: giống hệt 1, khác hẳn 0, không phân biệt dấu', () => {
    assert.equal(textSimilarity('12 Trần Phú', '12 tran phu'), 1);
    assert.equal(textSimilarity('abc', 'xyz'), 0);
    assert.equal(textSimilarity('', 'abc'), 0);
    const close = textSimilarity('Số 12 Trần Phú', '12 Trần Phú');
    assert.ok(close > 0.5 && close < 1, String(close));
  });

  it('giống hết mọi tiêu chí → 100% kèm đủ lý do', () => {
    assert.deepEqual(scoreDuplicate(subject, same), {
      similarity: 100,
      reasons: [
        'Cùng phường/xã',
        'Cách 10 m',
        'Cùng giá',
        'Cùng diện tích',
        'Cùng số điện thoại chủ nhà',
        'Địa chỉ giống 100%',
        'Mô tả giống 100%',
      ],
    });
  });

  it('giá, diện tích lệch theo bậc 2% / 5% / 10%', () => {
    // Giá lệch 4% (0,7), diện tích lệch 4% (0,7): mất 2 · 15 · 0,3 = 9 điểm.
    const score = scoreDuplicate(subject, { ...same, price: 4_800_000_000, area: 76.8 });
    assert.equal(score.similarity, 91);
    assert.ok(score.reasons.includes('Giá lệch 4%'));
    assert.ok(score.reasons.includes('Diện tích lệch 4%'));
    // Lệch 8% → 0,4.
    assert.equal(scoreDuplicate(subject, { ...same, area: 73.6 }).similarity, 91);
    // Lệch hơn 10% thì không còn lý do giống.
    const far = scoreDuplicate(subject, { ...same, price: 3_000_000_000 });
    assert.ok(!far.reasons.some((reason) => reason.startsWith('Giá')));
  });

  it('tiêu chí thiếu dữ liệu ở một bên thì không tính', () => {
    // Không toạ độ, không SĐT, không địa chỉ: còn phường 10, giá 15, diện tích 15, mô tả 10.
    const score = scoreDuplicate(
      { ...subject, ownerPhone: null, streetAddress: null },
      { ...same, distanceM: null, description: 'Nhà mới xây, gần biển, hẻm ô tô.' },
    );
    assert.equal(score.similarity, 100);
    assert.deepEqual(score.reasons, [
      'Cùng phường/xã',
      'Cùng giá',
      'Cùng diện tích',
      'Mô tả giống 100%',
    ]);
  });

  it('khác SĐT chủ nhà, khác phường, ở xa, khác địa chỉ, mô tả → thấp', () => {
    const score = scoreDuplicate(subject, {
      wardId: 'ward-khac',
      price: 5_000_000_000,
      area: 80,
      streetAddress: '99 Lê Lợi',
      description: 'Căn hộ tầng cao view thành phố',
      ownerPhone: '+84900000000',
      distanceM: 25,
    });
    // Toạ độ 15 + giá 15 + diện tích 15 = 45 / 100.
    assert.equal(score.similarity, 45);
    assert.ok(!score.reasons.includes('Cùng số điện thoại chủ nhà'));
  });
});
