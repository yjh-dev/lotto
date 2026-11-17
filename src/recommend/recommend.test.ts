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

test('추천 5게임: 30개 번호 서로 다름 · 규칙 통과 · 결정적 · 4등 이상 이론 최대', async () => {
  const { exactSetOdds } = await import('./odds.ts');
  const { recommend: rec5 } = await import('./recommend.ts');
  const recommend = (d: typeof draws, o: { seed?: number } = {}) => rec5(d, { games: 5, ...o });
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

test('고정 번호: 게임마다 하나씩, 30개 서로 다름 유지, 고정 없으면 기본 추천과 같음', async () => {
  const { recommend: recAny } = await import('./recommend.ts');
  const recommend = (d: typeof draws, o: { fixed?: number[] } = {}) => recAny(d, { games: 5, ...o });
  const base = recommend(draws);
  assert.deepEqual(recommend(draws, { fixed: [] }).picks, base.picks, '고정 없으면 시드 소비가 같아 기본 추천 그대로');
  const r = recommend(draws, { fixed: [7, 14, 33] });
  assert.deepEqual(r.fixed, [7, 14, 33]);
  [7, 14, 33].forEach((n, i) => assert.ok(r.picks[i].numbers.includes(n), `${i + 1}번째 게임에 ${n}`));
  assert.equal(new Set(r.picks.flatMap((p) => p.numbers)).size, 30);
  const ctx = ruleContext(draws);
  for (const p of r.picks) assert.deepEqual(ruleFlags(p.numbers, ctx), []);
  assert.throws(() => recommend(draws, { fixed: [1, 2, 3, 4, 5, 6] }), /최대 5개/);
});

test('추천 10게임(기본): 게임끼리 겹침 ≤1 · 규칙 통과 · 4등 이상 = 10 × 11,350 (이론 최대) · 고정 번호', async () => {
  const { exactSetOdds } = await import('./odds.ts');
  const { recommend, DEFAULT_GAMES } = await import('./recommend.ts');
  assert.equal(DEFAULT_GAMES, 10);
  const rec = recommend(draws);
  assert.equal(rec.picks.length, 10);
  const ctx = ruleContext(draws);
  for (const p of rec.picks) assert.deepEqual(ruleFlags(p.numbers, ctx), [], `규칙 위반 ${p.numbers}`);
  for (let i = 0; i < 10; i++)
    for (let j = i + 1; j < 10; j++) assert.ok(rec.picks[i].numbers.filter((n) => rec.picks[j].numbers.includes(n)).length <= 1, `겹침 ${i},${j}`);
  assert.equal(new Set(rec.picks.slice(0, 7).flatMap((p) => p.numbers)).size, 42, '앞 7게임은 서로소');
  assert.deepEqual(recommend(draws).picks, rec.picks, '결정적');
  const o = exactSetOdds(rec.picks.map((p) => p.numbers));
  close(o.atLeast4 * TOTAL_COMBOS, 10 * 11_350, 1e-6, '4등 이상 서로 배타');
  close(o.atLeast5 * TOTAL_COMBOS, 10 * 235, 1e-6, '3등 이상 서로 배타');
  const f = recommend(draws, { fixed: [9, 34] });
  assert.ok(f.picks[0].numbers.includes(9) && f.picks[1].numbers.includes(34));
  assert.equal(f.picks.filter((p) => p.numbers.includes(9)).length, 1, '고정 번호는 그 게임에만');
});

test('동점 처리(비인기 우선): 당첨 확률 그대로 · 인기도 배수 낮아짐 · 결정적', async () => {
  const { exactSetOdds } = await import('./odds.ts');
  const { recommend } = await import('./recommend.ts');
  const { fitNumberPopularity, comboMultiplier } = await import('./popularity.ts');
  const full = JSON.parse(readFileSync(new URL('../../data/draws.json', import.meta.url), 'utf8')).draws;
  const pop = fitNumberPopularity(full);
  assert.ok(pop.rows > 1000);
  const avg = (ps: { numbers: number[] }[]) => ps.reduce((a, p) => a + comboMultiplier(pop, p.numbers), 0) / ps.length;
  for (const games of [5, 10]) {
    const a = recommend(full, { games });
    const b = recommend(full, { games, popularity: pop });
    const oa = exactSetOdds(a.picks.map((p) => p.numbers));
    const ob = exactSetOdds(b.picks.map((p) => p.numbers));
    close(ob.atLeast4, oa.atLeast4, 1e-15, `${games}게임 4등 이상 불변`);
    close(ob.atLeast5, oa.atLeast5, 1e-15, `${games}게임 3등 이상 불변`);
    assert.ok(avg(b.picks) < avg(a.picks), `${games}게임 인기도 ${avg(b.picks)} < ${avg(a.picks)}`);
    close(b.popularity!.average, avg(b.picks), 1e-12);
    assert.deepEqual(recommend(full, { games, popularity: pop }).picks, b.picks, '결정적');
  }
});

test('인기도 모형: 합성 데이터에서 많이 고른 번호를 찾아냄', async () => {
  const { fitNumberPopularity } = await import('./popularity.ts');
  const rng = mulberry32(77);
  const hot = new Set([3, 7, 11]);
  const synth = simulateHistory(1500, rng).map((d) => {
    const k = d.numbers.filter((n) => hot.has(n)).length;
    const exp = 1000 * 182_780 / TOTAL_COMBOS; // 판매 100만 원 → 1000장
    return { numbers: d.numbers, totalSales: 1_000_000_000, prizes: [1, 2, 3, 4, 5].map((r) => ({ winners: r === 5 ? Math.round(exp * 1000 * Math.exp(0.1 * k)) : 1 })) };
  });
  const p = fitNumberPopularity(synth);
  const top = Array.from({ length: 45 }, (_, i) => i + 1).sort((a, b) => p.beta[b] - p.beta[a]).slice(0, 3);
  assert.deepEqual(top.sort((a, b) => a - b), [3, 7, 11]);
});

test('핫 번호 방식: 게임마다 핫 번호 정확히 2개 · 핫 번호마다 2게임 · 겹침 ≤1 · 규칙 통과 · 4등 이상 그대로', async () => {
  const { exactSetOdds } = await import('./odds.ts');
  const { recommend, hotNumbers } = await import('./recommend.ts');
  const hot = hotNumbers(draws, 10);
  assert.equal(hot.length, 10);
  const c = new Array(46).fill(0);
  draws.slice(-50).forEach((d) => d.numbers.forEach((n) => c[n]++));
  assert.ok(hot.every((h) => c[h] >= Math.max(...Array.from({ length: 45 }, (_, i) => i + 1).filter((n) => !hot.includes(n)).map((n) => c[n]))), '핫 = 최근 50회 상위');
  const r = recommend(draws, { strategy: 'hot' });
  assert.equal(r.strategy, 'hot');
  assert.deepEqual(r.hot, hot);
  for (const p of r.picks) assert.equal(p.numbers.filter((n) => hot.includes(n)).length, 2, `${p.numbers}`);
  for (const h of hot) assert.equal(r.picks.filter((p) => p.numbers.includes(h)).length, 2, `핫 ${h}`);
  for (let i = 0; i < 10; i++)
    for (let j = i + 1; j < 10; j++) assert.ok(r.picks[i].numbers.filter((n) => r.picks[j].numbers.includes(n)).length <= 1);
  const ctx = ruleContext(draws);
  for (const p of r.picks) assert.deepEqual(ruleFlags(p.numbers, ctx), []);
  const o = exactSetOdds(r.picks.map((p) => p.numbers));
  close(o.atLeast4 * TOTAL_COMBOS, 10 * 11_350, 1e-6, '4등 이상 이론 최대 유지');
  assert.deepEqual(recommend(draws, { strategy: 'hot' }).picks, r.picks, '결정적');
  assert.throws(() => recommend(draws, { strategy: 'hot', fixed: [1] }));
});
