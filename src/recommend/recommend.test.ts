/**
 * 백테스트·추천 규칙·규칙 감시·당첨 확률 검증 — 정답을 아는 데이터로 확인
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../stats/math.ts';
import { simulateHistory } from '../stats/simulate.ts';
import { MATCH_MEAN, MATCH_VAR, prizeRank, runBacktest } from '../stats/backtest.ts';
import { acValue, auditRules, eligibleShare, MIN_ELIGIBLE_SHARE, ruleContext, ruleFlags, RULES } from './rules.ts';
import { TOTAL_COMBOS } from '../stats/probability.ts';
import { readFileSync } from 'node:fs';

const { draws } = JSON.parse(readFileSync(new URL('../../data/draws.json', import.meta.url), 'utf8')) as { draws: { round: number; numbers: number[]; bonus: number }[] };

const close = (a: number, b: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≉ ${b} (tol ${tol})`);

test('등수 판정', () => {
  const d = { numbers: [1, 2, 3, 4, 5, 6], bonus: 7 };
  assert.equal(prizeRank([1, 2, 3, 4, 5, 6], d), 1);
  assert.equal(prizeRank([1, 2, 3, 4, 5, 7], d), 2);
  assert.equal(prizeRank([1, 2, 3, 4, 5, 8], d), 3);
  assert.equal(prizeRank([1, 2, 3, 4, 9, 8], d), 4);
  assert.equal(prizeRank([1, 2, 3, 10, 9, 8], d), 5);
  assert.equal(prizeRank([1, 2, 7, 10, 9, 8], d), 0);
});

test('백테스트: 공정한 데이터에서 모든 전략의 평균 일치 = 0.8 (초기하분포)', () => {
  const h = simulateHistory(5000, mulberry32(11)).map((d, i) => ({ ...d, round: i + 1 }));
  const res = runBacktest(h, undefined, { startRound: 101 });
  const se = Math.sqrt(MATCH_VAR / res[0].games);
  for (const r of res) close(r.meanMatches, MATCH_MEAN, 4 * se, r.name);
  assert.ok(res.every((r) => r.qValue > 0.01), '어떤 전략도 유의하지 않아야 함');
});

test('백테스트: 미래 정보 누출 없음 — "직전 회차 반복"이 같은 회차를 보지 않음', () => {
  // 매 회차 같은 번호가 나오는 극단적 데이터 → 직전 반복 전략은 6개 모두 맞혀야 하고, 첫 평가 회차도 예외 없음
  const h = Array.from({ length: 300 }, (_, i) => ({ numbers: [1, 2, 3, 4, 5, 6], bonus: 7, round: i + 1 }));
  const r = runBacktest(h, undefined, { startRound: 2 }).find((x) => x.key === 'repeat')!;
  close(r.meanMatches, 6, 0);
  // 반대로, 서로 겹치지 않는 번호가 번갈아 나오면 0개
  const alt = Array.from({ length: 300 }, (_, i) => ({
    numbers: i % 2 ? [1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12], bonus: 13, round: i + 1,
  }));
  close(runBacktest(alt, undefined, { startRound: 2 }).find((x) => x.key === 'repeat')!.meanMatches, 0, 0);
});

test('당첨 확률: 전수 대입 결과가 조합론 정확값과 일치', async () => {
  const { exactSetOdds, bayesRatio, firstPrizeOverYears } = await import('./odds.ts');
  const one = exactSetOdds([[3, 12, 19, 27, 38, 44]]);
  close(one.first * TOTAL_COMBOS, 1, 1e-9, '1등 1가지');
  close(one.atLeast5 * TOTAL_COMBOS, 1 + 6 + 228, 1e-9, '5개 이상 = 1·2·3등');
  close(one.atLeast4 * TOTAL_COMBOS, 1 + 6 + 228 + 11_115, 1e-9, '4개 이상');
  close(one.anyPrize * TOTAL_COMBOS, 194_130, 1e-9, '3개 이상 = 1~5등');
  // 같은 조합을 두 번 사도 확률은 그대로, 서로 다른 조합 k개의 1등은 정확히 k/C(45,6)
  close(exactSetOdds([[3, 12, 19, 27, 38, 44], [3, 12, 19, 27, 38, 44]]).anyPrize, one.anyPrize, 1e-15);
  close(exactSetOdds([[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12]]).first * TOTAL_COMBOS, 2, 1e-9);
  close(bayesRatio(new Array(46).fill(1 / 45), [1, 2, 3, 4, 5, 6]), 1, 1e-9, '균등 θ면 배수 1');
  close(firstPrizeOverYears(5, 0), 0, 1e-15);
});

test('우리 규칙: 판정 예시', () => {
  const none = ruleContext([]);
  assert.deepEqual(ruleFlags([3, 12, 19, 27, 38, 44], none), [], '평범한 조합은 통과');
  assert.ok(ruleFlags([20, 21, 22, 25, 28, 39], none).includes('run3'));
  assert.ok(ruleFlags([5, 10, 15, 20, 25, 30], none).includes('arith'));
  assert.ok(ruleFlags([11, 13, 25, 27, 39, 41], none).includes('oddEven'));
  assert.ok(ruleFlags([1, 4, 8, 12, 17, 22], none).includes('lowHigh'));
  assert.ok(ruleFlags([1, 2, 4, 7, 9, 13], none).includes('sum'), '합계 36');
  assert.ok(ruleFlags([31, 33, 36, 39, 40, 44], none).includes('decade'), '31~40에 5개');
  assert.equal(acValue([1, 2, 3, 4, 5, 6]), 0);
  assert.equal(acValue([1, 2, 4, 8, 16, 32]), 10);
  // 과거 의존 규칙
  const hist = [{ numbers: [3, 12, 19, 27, 38, 44] }, { numbers: [1, 9, 17, 25, 33, 41] }];
  const ctx = ruleContext(hist);
  assert.ok(ruleFlags([44, 38, 27, 19, 12, 3], ctx).includes('past'), '정렬과 무관하게 같은 조합');
  assert.ok(ruleFlags([1, 9, 17, 25, 2, 40], ctx).includes('recent'), '최근 회차와 4개 일치');
  assert.ok(!ruleFlags([1, 9, 17, 4, 2, 40], ctx).includes('recent'), '3개 일치는 통과');
  assert.deepEqual(ruleFlags([11, 13, 25, 27, 39, 41], none, ['oddEven']), ['ac'], '해제한 규칙은 무시 (홀수만이면 차이가 모두 짝수라 AC도 낮음)');
});

test('규칙 감시: 공정한 추첨이면 경고 없음, 실제 비율 ≈ 무작위 비율', () => {
  const fair = simulateHistory(1500, mulberry32(31)).map((d, i) => ({ ...d, round: i + 1 }));
  const audit = auditRules(fair);
  assert.equal(audit.length, RULES.length);
  assert.ok(audit.every((r) => !r.warn), audit.filter((r) => r.warn).map((r) => r.key).join());
  for (const r of audit) close(r.observed / r.draws, r.expectedRate, 4 * Math.sqrt((r.expectedRate * (1 - r.expectedRate)) / r.draws) + 1e-9, r.key);
  // 조작된 추첨(홀수만 나옴)은 홀짝 규칙을 경고해야 함
  const odd = fair.map((d, i) => ({ ...d, numbers: i % 10 === 0 ? [1, 7, 15, 23, 33, 41] .map((n) => n + 2 * (i % 3)).sort((a, b) => a - b) : d.numbers }));
  assert.ok(auditRules(odd).find((r) => r.key === 'oddEven')!.warn, '홀수만 나오는 회차가 많으면 경고');
});

test('추천: 30개 번호 서로 다름 · 규칙 통과 · 결정적 · 4등 이상 이론 최대', async () => {
  const { exactSetOdds } = await import('./odds.ts');
  const { recommend } = await import('./recommend.ts');
  const rec = recommend(draws);
  assert.equal(rec.picks.length, 5);
  assert.equal(rec.targetRound, draws.at(-1)!.round + 1);
  assert.equal(new Set(rec.picks.flatMap((p) => p.numbers)).size, 30, '번호 30개 모두 다름');
  const ctx = ruleContext(draws);
  for (const p of rec.picks) assert.deepEqual(ruleFlags(p.numbers, ctx), [], `규칙 위반 ${p.numbers}`);
  assert.deepEqual(recommend(draws).picks, rec.picks, '같은 데이터 → 같은 추천');
  assert.notDeepEqual(recommend(draws, { seed: 7 }).picks, rec.picks);
  assert.ok(rec.eligibleShare >= MIN_ELIGIBLE_SHARE, `후보 하한 ${rec.eligibleShare}`);
  close(eligibleShare(ctx), rec.eligibleShare, 1e-12);
  const o = exactSetOdds(rec.picks.map((p) => p.numbers));
  close(o.atLeast4 * TOTAL_COMBOS, 5 * 11_350, 1e-6, '4등 이상 = 5 × 11,350 (서로 배타)');
  close(o.atLeast5 * TOTAL_COMBOS, 5 * 235, 1e-6, '3등 이상 = 5 × 235');
  // 서로소 묶음은 대칭 → 어떤 서로소 묶음과도 당첨 확률이 같음
  const ref = exactSetOdds([0, 1, 2, 3, 4].map((g) => [1, 2, 3, 4, 5, 6].map((n) => n + 6 * g)));
  close(o.anyPrize, ref.anyPrize, 1e-12, '당첨 확률 = 서로소 기준값');
});
