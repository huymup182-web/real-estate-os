import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type MatchPreference,
  type MatchProperty,
  scoreMatch,
} from '../src/matching/match-score.js';

const NHA_TRANG = 'province-khanh-hoa';
const VINH_HAI = 'ward-vinh-hai';

const noPreference: MatchPreference = {
  transactionType: 'SALE',
  propertyTypes: null,
  budgetMin: null,
  budgetMax: null,
  areaMin: null,
  areaMax: null,
  bedroomsMin: null,
  provinceIds: null,
  districtIds: null,
  wardIds: null,
  legalStatuses: null,
  minRoadAccess: null,
};

/** Khách A trong master plan: 4–6 tỷ, Nha Trang, 3+ phòng ngủ, ô tô vào được. */
const customerA: MatchPreference = {
  ...noPreference,
  propertyTypes: ['HOUSE', 'VILLA'],
  budgetMin: 4_000_000_000,
  budgetMax: 6_000_000_000,
  areaMin: 60,
  areaMax: 100,
  bedroomsMin: 3,
  provinceIds: [NHA_TRANG],
  legalStatuses: ['PINK_BOOK'],
  minRoadAccess: 'CAR',
};

const house: MatchProperty = {
  transactionType: 'SALE',
  propertyType: 'HOUSE',
  price: 5_000_000_000,
  area: 80,
  bedrooms: 3,
  provinceId: NHA_TRANG,
  districtId: null,
  wardId: VINH_HAI,
  legalStatus: 'PINK_BOOK',
  roadAccess: 'CAR',
};

function ratioOf(preference: MatchPreference, property: MatchProperty, criterion: string): number {
  const found = scoreMatch(preference, property).criteria.find(
    (item) => item.criterion === criterion,
  );
  assert.ok(found, criterion);
  return found.ratio;
}

describe('scoreMatch (TASK-086)', () => {
  it('khớp hết mọi tiêu chí → 100%, đủ 7 tiêu chí theo trọng số 30/25/15/10/10/5/5', () => {
    const result = scoreMatch(customerA, house);
    assert.equal(result.eligible, true);
    assert.equal(result.score, 100);
    assert.deepEqual(
      result.criteria.map((item) => [item.criterion, item.weight, item.ratio]),
      [
        ['price', 30, 1],
        ['location', 25, 1],
        ['area', 15, 1],
        ['bedrooms', 10, 1],
        ['propertyType', 10, 1],
        ['road', 5, 1],
        ['legal', 5, 1],
      ],
    );
  });

  it('khác loại giao dịch → không khớp, 0 điểm', () => {
    assert.deepEqual(scoreMatch(customerA, { ...house, transactionType: 'RENT' }), {
      eligible: false,
      score: 0,
      criteria: [],
    });
  });

  it('điểm = tổng trọng số × mức đạt: sai khu vực (−25) và sai pháp lý (−5) → 70%', () => {
    const result = scoreMatch(customerA, {
      ...house,
      provinceId: 'province-khac',
      wardId: 'ward-khac',
      legalStatus: 'SALE_CONTRACT',
    });
    assert.equal(result.score, 70);
  });

  it('giá, diện tích: trong khoảng (gồm biên) → 1; lệch giảm dần, lệch từ 20% → 0', () => {
    for (const [price, ratio] of [
      [4_000_000_000, 1],
      [6_000_000_000, 1],
      [6_600_000_000, 0.5],
      [7_200_000_000, 0],
      [9_000_000_000, 0],
      [3_600_000_000, 0.5],
      [3_000_000_000, 0],
    ] as const) {
      assert.ok(
        Math.abs(ratioOf(customerA, { ...house, price }, 'price') - ratio) < 1e-9,
        `${price}`,
      );
    }
    assert.ok(Math.abs(ratioOf(customerA, { ...house, area: 110 }, 'area') - 0.5) < 1e-9);
    assert.equal(ratioOf(customerA, { ...house, area: 48 }, 'area'), 0);
    // Chỉ nêu một mốc.
    const maxOnly = { ...noPreference, budgetMax: 5_000_000_000 };
    assert.equal(ratioOf(maxOnly, { ...house, price: 1 }, 'price'), 1);
    assert.ok(Math.abs(ratioOf(maxOnly, { ...house, price: 5_500_000_000 }, 'price') - 0.5) < 1e-9);
  });

  it('khu vực: trong bất kỳ tỉnh, quận hoặc phường khách nêu → 1, ngoài → 0', () => {
    const byWard = { ...noPreference, wardIds: ['ward-khac', VINH_HAI] };
    assert.equal(ratioOf(byWard, house, 'location'), 1);
    assert.equal(ratioOf(byWard, { ...house, wardId: 'ward-x' }, 'location'), 0);
    const byDistrict = { ...noPreference, districtIds: ['district-1'] };
    assert.equal(ratioOf(byDistrict, { ...house, districtId: 'district-1' }, 'location'), 1);
    assert.equal(ratioOf(byDistrict, house, 'location'), 0);
  });

  it('phòng ngủ: đủ → 1, thiếu 1 → 0.5, thiếu hơn hoặc chưa ghi → 0', () => {
    assert.equal(ratioOf(customerA, { ...house, bedrooms: 5 }, 'bedrooms'), 1);
    assert.equal(ratioOf(customerA, { ...house, bedrooms: 2 }, 'bedrooms'), 0.5);
    assert.equal(ratioOf(customerA, { ...house, bedrooms: 1 }, 'bedrooms'), 0);
    assert.equal(ratioOf(customerA, { ...house, bedrooms: null }, 'bedrooms'), 0);
  });

  it('loại BĐS, pháp lý theo danh sách; đường vào: ô tô > xe máy > đi bộ', () => {
    assert.equal(ratioOf(customerA, { ...house, propertyType: 'VILLA' }, 'propertyType'), 1);
    assert.equal(ratioOf(customerA, { ...house, propertyType: 'LAND' }, 'propertyType'), 0);
    assert.equal(ratioOf(customerA, { ...house, legalStatus: null }, 'legal'), 0);
    assert.equal(ratioOf(customerA, { ...house, roadAccess: 'MOTORBIKE' }, 'road'), 0);
    assert.equal(ratioOf(customerA, { ...house, roadAccess: null }, 'road'), 0);
    const motorbike = { ...noPreference, minRoadAccess: 'MOTORBIKE' };
    assert.equal(ratioOf(motorbike, house, 'road'), 1);
    assert.equal(ratioOf(motorbike, { ...house, roadAccess: 'MOTORBIKE' }, 'road'), 1);
    assert.equal(ratioOf(motorbike, { ...house, roadAccess: 'WALK' }, 'road'), 0);
  });

  it('tiêu chí khách không nêu thì không tính; không nêu gì → 100%', () => {
    const budgetAndArea = {
      ...noPreference,
      budgetMax: 6_000_000_000,
      provinceIds: ['province-khac'],
      minRoadAccess: 'WALK',
      bedroomsMin: 0,
    };
    const result = scoreMatch(budgetAndArea, house);
    assert.deepEqual(
      result.criteria.map((item) => item.criterion),
      ['price', 'location'],
    );
    // Đạt 30 trên 55 điểm của hai tiêu chí đã nêu.
    assert.equal(result.score, 55);
    assert.equal(scoreMatch(noPreference, house).score, 100);
    assert.deepEqual(scoreMatch(noPreference, house).criteria, []);
  });
});
