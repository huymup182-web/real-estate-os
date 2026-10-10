import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  fetchLeaderboard,
  type LeaderboardAgent,
  leaderboardHref,
  leaderboardSort,
  rankBy,
} from './leaderboard.ts';

const agent = (fullName: string, values: Partial<LeaderboardAgent>): LeaderboardAgent => ({
  rank: 0,
  userId: fullName,
  fullName,
  avatarUrl: null,
  points: 0,
  listings: 0,
  careDays: 0,
  viewings: 0,
  dealsWon: 0,
  revenue: 0,
  ...values,
});

const AGENTS = [
  agent('An', { points: 35, listings: 2, dealsWon: 1, revenue: 5e9 }),
  agent('Bình', { points: 25, listings: 1, dealsWon: 1, revenue: 6e9 }),
  agent('Cường', { points: 25, listings: 5 }),
];

describe('leaderboard', () => {
  it('leaderboardSort: giá trị lạ là Top môi giới', () => {
    assert.equal(leaderboardSort('revenue'), 'revenue');
    assert.equal(leaderboardSort('deals'), 'deals');
    assert.equal(leaderboardSort('toString'), 'points');
    assert.equal(leaderboardSort(['revenue']), 'points');
    assert.equal(leaderboardSort(undefined), 'points');
  });

  it('rankBy: xếp theo chỉ số của bảng, bằng nhau cùng hạng rồi theo điểm', () => {
    const view = (sort: Parameters<typeof rankBy>[1]) =>
      rankBy(AGENTS, sort).map((item) => [item.rank, item.fullName]);
    assert.deepEqual(view('points'), [
      [1, 'An'],
      [2, 'Bình'],
      [2, 'Cường'],
    ]);
    assert.deepEqual(view('revenue'), [
      [1, 'Bình'],
      [2, 'An'],
      [3, 'Cường'],
    ]);
    assert.deepEqual(view('listings'), [
      [1, 'Cường'],
      [2, 'An'],
      [3, 'Bình'],
    ]);
    assert.deepEqual(view('deals'), [
      [1, 'An'],
      [1, 'Bình'],
      [3, 'Cường'],
    ]);
  });

  it('leaderboardHref bỏ tham số mặc định', () => {
    assert.equal(leaderboardHref('points', 30), '/leaderboard');
    assert.equal(leaderboardHref('revenue', 30), '/leaderboard?by=revenue');
    assert.equal(leaderboardHref('points', 7), '/leaderboard?days=7');
    assert.equal(leaderboardHref('deals', 90), '/leaderboard?by=deals&days=90');
  });

  it('fetchLeaderboard gọi /reports/leaderboard với kỳ [now - days, now) và access token', async () => {
    let request: Request | undefined;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      request = new Request(input, init);
      return Response.json({ data: { agents: [] } });
    }) as typeof fetch;
    const result = await fetchLeaderboard('acc', 7, new Date('2026-10-10T00:00:00.000Z'), {
      fetchImpl,
      env: { API_INTERNAL_URL: 'http://backend:3000' },
    });
    assert.equal(result.ok, true);
    const url = new URL(request?.url ?? '');
    assert.equal(url.pathname, '/api/v1/reports/leaderboard');
    assert.equal(url.searchParams.get('from'), '2026-10-03T00:00:00.000Z');
    assert.equal(url.searchParams.get('to'), '2026-10-10T00:00:00.000Z');
    assert.equal(request?.headers.get('authorization'), 'Bearer acc');
  });
});
