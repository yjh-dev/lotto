/** 정확한 값 검증: 수치함수, 조합론 공식, 다중비교 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  betaQuantile, chiSquareSF, choose, ksSF, lnGamma, normalCdf, normalTwoSidedP, regBeta,
} from './math.ts';
import {
  TOTAL_COMBOS, matchPmf, noConsecutiveProbability, oddCountPmf, overlapPmf, prizeOdds, rangePmf,
  sumDistribution, sumMoments, gapPmf, P_PAIR,
} from './probability.ts';
import { benjaminiHochberg, mergeSmallBins } from './hypothesis.ts';
import { empiricalPValue } from './simulate.ts';

const close = (a: number, b: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≉ ${b} (tol ${tol})`);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

test('감마 함수', () => {
  close(lnGamma(5), Math.log(24), 1e-12);
  close(lnGamma(0.5), 0.5 * Math.log(Math.PI), 1e-12);
  close(lnGamma(101), 363.73937555556347, 1e-9);
});

test('분포 함수: 알려진 임계값', () => {
  close(chiSquareSF(3.841458820694124, 1), 0.05, 1e-9, 'χ²(1) 95%');
  close(chiSquareSF(60.48088598, 44), 0.05, 1e-7, 'χ²(44) 95%');
  close(chiSquareSF(124.342, 100), 0.05, 1e-4, 'χ²(100) 95%');
  close(normalCdf(1.959963984540054), 0.975, 1e-12);
  close(normalCdf(-1.959963984540054), 0.025, 1e-12);
  close(normalTwoSidedP(2.5758293035489), 0.01, 1e-12);
  close(regBeta(0.5, 2, 3), 11 / 16, 1e-12);
  close(betaQuantile(11 / 16, 2, 3), 0.5, 1e-10);
  close(ksSF(1.3580986 / Math.sqrt(1e6), 1e6), 0.05, 1e-4, 'KS 95%');
});

test('조합 수와 당첨 확률', () => {
  assert.equal(choose(45, 6), 8_145_060);
  assert.equal(TOTAL_COMBOS, 8_145_060);
  const odds = prizeOdds();
  assert.deepEqual(odds.map((o) => o.combos), [1, 6, 228, 11_115, 182_780]);
  // 아무 등수나 당첨될 확률 ≈ 1/42
  close(1 / sum(odds.map((o) => o.probability)), 41.957, 1e-3);
  // 일치 개수 초기하분포: 합 1, 기대값 6·6/45 = 0.8
  const m = Array.from({ length: 7 }, (_, k) => matchPmf(k));
  close(sum(m), 1, 1e-12);
  close(sum(m.map((p, k) => p * k)), 0.8, 1e-12);
});

test('합계 분포: DP 결과가 유한모집단 공식과 일치', () => {
  const d = sumDistribution();
  close(sum(d), 1, 1e-12);
  const mu = sum(d.map((p, s) => p * s));
  const v = sum(d.map((p, s) => p * (s - mu) ** 2));
  const t = sumMoments();
  close(mu, 138, 1e-9);
  close(t.mean, 138, 1e-12);
  close(v, t.variance, 1e-6);
  close(t.variance, (6 * ((45 * 45 - 1) / 12) * 39) / 44, 1e-9);
  // 최솟값 1+2+…+6=21, 최댓값 40+…+45=255 는 각각 1가지
  close(d[21] * TOTAL_COMBOS, 1, 1e-6);
  close(d[255] * TOTAL_COMBOS, 1, 1e-6);
});

test('조합 특성 분포들이 확률분포(합 1)', () => {
  close(sum(oddCountPmf()), 1, 1e-12);
  close(sum(overlapPmf()), 1, 1e-12);
  close(sum(rangePmf()), 1, 1e-12);
  close(sum(overlapPmf().map((p, k) => p * k)), 0.8, 1e-12);
  // 연속번호 없음 = C(40,6)/C(45,6)
  close(noConsecutiveProbability(), 3_838_380 / 8_145_060, 1e-12);
  // 기하분포 합
  let g = 0;
  for (let i = 1; i < 2000; i++) g += gapPmf(i);
  close(g, 1, 1e-12);
  close(P_PAIR, 1 / 66, 1e-15);
});

test('Benjamini–Hochberg', () => {
  const q = benjaminiHochberg([0.01, 0.04, 0.03, 0.005]);
  q.forEach((x, i) => close(x, [0.02, 0.04, 0.04, 0.02][i], 1e-12));
});

test('작은 구간 병합: 총합 보존, 모든 기대값 ≥ 5', () => {
  const o = [1, 2, 30, 40, 3, 1, 0];
  const e = [0.5, 3, 30, 40, 4, 1.5, 1];
  const m = mergeSmallBins(o, e);
  close(sum(m.observed), sum(o), 0);
  close(sum(m.expected), sum(e), 1e-12);
  assert.ok(m.expected.every((x) => x >= 5));
});

test('경험적 p-value', () => {
  const nullDist = Array.from({ length: 99 }, (_, i) => i); // 0..98
  close(empiricalPValue(98, nullDist), 2 / 100, 1e-12);
  close(empiricalPValue(1000, nullDist), 1 / 100, 1e-12);
});
