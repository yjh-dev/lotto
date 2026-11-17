/** 내 구매 계산: 지급 기한 · 미수령 · 누적 손익 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimDeadline, cumulativeSeries, unclaimedWins } from './views-buy.ts';
import type { StoredPurchase } from '../db/repository.ts';
import type { Draw } from '../data/types.ts';

const draw = (round: number, date: string): Draw => ({
  round, date, numbers: [1, 2, 3, 4, 5, 6], bonus: 7, totalSales: 0, prizePool: 0,
  prizes: [2e9, 5e7, 1.5e6, 50_000, 5_000].map((amount, i) => ({ rank: (i + 1) as 1, winners: 1, amount })),
  firstWinType: { unknown: 0, auto: 0, manual: 0, semiAuto: 0 },
});
const buy = (round: number, rank: number, extra: Partial<StoredPurchase> = {}): StoredPurchase => ({
  ticketKey: `k${round}`, slot: 0, targetRound: round, mode: 'auto', numbers: [1, 2, 3, 10, 11, 12], createdAt: '',
  matched: 3, prizeRank: rank, prizeAmount: [0, 2e9, 5e7, 1.5e6, 50_000, 5_000][rank], claimedAt: null, ...extra,
});

test('지급 기한: 추첨 다음 날부터 1년', () => {
  assert.equal(claimDeadline('2026-11-21').toISOString(), '2027-11-21T15:00:00.000Z'); // 2027-11-22 00:00 KST
});

test('미수령 당첨: 기한 임박 순, 받은 것·낙첨 제외', () => {
  const draws = [draw(1, '2026-01-03'), draw(2, '2026-06-06')];
  const list = [buy(2, 5), buy(1, 4), buy(1, 0, { slot: 1 }), buy(2, 5, { slot: 2, claimedAt: 'x' })];
  const u = unclaimedWins(list, draws, new Date('2026-12-10T00:00:00+09:00'));
  assert.deepEqual(u.map((x) => x.p.targetRound), [1, 2]);
  assert.equal(u[0].daysLeft, 25);
});

test('누적 손익: 구매액 · 당첨금 · 이론 기대(그 회차 실제 당첨금 기준)', () => {
  const draws = [draw(1, '2026-01-03'), draw(2, '2026-01-10')];
  const list = [buy(1, 5), buy(1, 0, { slot: 1 }), buy(2, 0), buy(3, 0, { matched: null, prizeRank: null, prizeAmount: null })];
  const c = cumulativeSeries(list, draws);
  assert.deepEqual(c.labels, [1, 2], '추첨 안 된 3회는 제외');
  assert.deepEqual(c.spent, [2000, 3000]);
  assert.deepEqual(c.won, [5000, 5000]);
  // 게임당 기대 = Σ P(등수)·당첨금
  const per = [1, 6, 228, 11_115, 182_780].map((n) => n / 8_145_060);
  const e = [2e9, 5e7, 1.5e6, 50_000, 5_000].reduce((a, v, i) => a + per[i] * v, 0);
  assert.equal(c.expected[1], Math.round(3 * e));
});

test('실수령액: 200만 원 이하 비과세, 3억까지 22%, 초과분 33%', async () => {
  const { prizeTax, netPrize } = await import('./tax.ts');
  assert.equal(prizeTax(50_000), 0);
  assert.equal(prizeTax(2_000_000), 0);
  assert.equal(prizeTax(2_000_001), Math.round((2_000_001 - 1000) * 0.22));
  assert.equal(prizeTax(1e9), Math.round(3e8 * 0.22 + (1e9 - 1000 - 3e8) * 0.33));
  assert.equal(netPrize(5_000), 5_000);
});

test('건너뛴 회차 · 연간 리포트', async () => {
  const { skippedRounds, annualReport } = await import('./views-buy.ts');
  const list = [buy(1, 5), buy(3, 0), buy(4, 0, { matched: null, prizeRank: null, prizeAmount: null })];
  assert.deepEqual(skippedRounds(list, 5), [2, 5], '첫 구매 이후 용지 없는 회차');
  assert.deepEqual(skippedRounds([], 5), []);
  const draws = [draw(1, '2025-12-27'), draw(3, '2026-01-10')];
  const y = annualReport(list, draws);
  assert.deepEqual(y.map((r) => [r.year, r.games, r.graded, r.won, r.best]), [['추첨 전', 1, 0, 0, 0], ['2026', 1, 1, 0, 0], ['2025', 1, 1, 5000, 5]]);
});

test('내 번호 시험: 기간 안 회차만, 실제 당첨금 합산', async () => {
  const { simulateMine } = await import('./views-stats.ts');
  const draws = [draw(1, '2026-01-03'), draw(2, '2026-01-10'), draw(3, '2026-01-17')];
  draws[1] = { ...draws[1], numbers: [10, 11, 12, 13, 14, 15] };
  const r = simulateMine(draws, [1, 2, 3, 4, 5, 7], 1, 2);
  assert.equal(r.draws, 2);
  assert.deepEqual(r.ranks, [0, 0, 1, 0, 0, 0], '1회: 5개 + 보너스 7 → 2등');
  assert.equal(r.won, 5e7);
  assert.deepEqual(r.bigWins, [{ round: 1, rank: 2, amount: 5e7 }]);
});

test('기간: 최근 N회 기준, 예전 연 단위 저장값은 전체로', async () => {
  const { resolvePeriod, PRESETS } = await import('./period.ts');
  const draws = Array.from({ length: 1250 }, (_, i) => draw(i + 1, '2026-01-03'));
  assert.equal(resolvePeriod({ key: 'r500' }, draws).from, 751);
  assert.equal(resolvePeriod({ key: 'r50' }, draws).count, 50);
  assert.ok(PRESETS.every((p) => !/년/.test(p.label)), '연 단위 표기 없음');
});
