/**
 * 몬테카를로 교차검증: 공정한 로또를 시뮬레이션해서
 *  (1) 이론 분포가 실제 추첨 과정과 일치하는지
 *  (2) 각 검정이 H₀에서 명목 유의수준(5%)대로 기각하는지 (p-value 보정 확인)
 * 시드 고정 → 결과 재현 가능.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chiSquareSF, mean, mulberry32, variance } from './math.ts';
import { noConsecutiveProbability, oddCountPmf, rangePmf, sumMoments } from './probability.ts';
import {
  appearanceSeries, completedGaps, drawRange, drawSum, hasConsecutive, numberCounts, oddCount, overlaps,
} from './descriptive.ts';
import { frequencyUniformityTest, gapGeometricTest, ljungBox, runsTest } from './hypothesis.ts';
import { logBayesFactor } from './bayes.ts';
import { numberEntropy } from './information.ts';
import { simulateHistory } from './simulate.ts';

const close = (a: number, b: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≉ ${b} (tol ${tol})`);
/** 기각률 허용 범위: 5% ± 3·SE */
const rateTol = (reps: number) => 3 * Math.sqrt((0.05 * 0.95) / reps);

test('이론 분포 ↔ 시뮬레이션 (20만 회차)', () => {
  const h = simulateHistory(200_000, mulberry32(1));
  const sums = h.map(drawSum);
  const t = sumMoments();
  close(mean(sums), t.mean, 0.2, '합계 평균');
  close(variance(sums), t.variance, 8, '합계 분산');

  const odd = oddCountPmf();
  const oddObs = new Array(7).fill(0);
  h.forEach((d) => oddObs[oddCount(d)]++);
  oddObs.forEach((c, k) => close(c / h.length, odd[k], 0.004, `홀수 ${k}개`));

  close(h.filter((d) => !hasConsecutive(d)).length / h.length, noConsecutiveProbability(), 0.004, '연속번호 없음');

  const rp = rangePmf();
  close(mean(h.map(drawRange)), rp.reduce((a, p, r) => a + p * r, 0), 0.05, '범위 평균');

  close(mean(overlaps(h)), 0.8, 0.005, '이월수 평균');
  close(mean(completedGaps(h)), 45 / 6, 0.02, '재출현 간격 평균 = 1/p');
});

test('번호 빈도 검정: 비복원추출 보정 (39/44)이 필요함을 확인', () => {
  const reps = 2000;
  const rng = mulberry32(2);
  const raw: number[] = [];
  let rejectCorrected = 0;
  let rejectNaive = 0;
  for (let i = 0; i < reps; i++) {
    const r = frequencyUniformityTest(simulateHistory(1250, rng));
    raw.push(r.rawStatistic);
    if (r.pValue < 0.05) rejectCorrected++;
    if (chiSquareSF(r.rawStatistic, 44) < 0.05) rejectNaive++;
  }
  // 이론: E[X²] = 44·(39/44) = 39 (보정 안 한 χ²(44)라면 44)
  close(mean(raw), 39, 0.6, '보정 전 X² 평균');
  close(rejectCorrected / reps, 0.05, rateTol(reps), '보정 후 기각률');
  assert.ok(rejectNaive / reps < 0.03, `보정 없이 쓰면 기각률이 과소(${rejectNaive / reps})`);
});

test('런 검정 · Ljung–Box · 간격 검정이 H₀에서 5% 기각', () => {
  const reps = 600;
  const rng = mulberry32(3);
  let runsRej = 0;
  let lbRej = 0;
  let gapRej = 0;
  for (let i = 0; i < reps; i++) {
    const h = simulateHistory(1250, rng);
    if (runsTest(appearanceSeries(h, 1 + (i % 45))).pValue < 0.05) runsRej++;
    if (ljungBox(h.map(drawSum), 10).pValue < 0.05) lbRej++;
    if (gapGeometricTest(completedGaps(h)).pValue < 0.05) gapRej++;
  }
  // 이산 정규근사·구간 병합 오차를 감안해 허용폭 3·SE
  close(runsRej / reps, 0.05, rateTol(reps), '런 검정');
  close(lbRej / reps, 0.05, rateTol(reps), 'Ljung–Box');
  close(gapRej / reps, 0.05, rateTol(reps) + 0.01, '간격 검정');
});

test('베이즈 인자: 균등 데이터 → 균등 모형, 편향 데이터 → 편향 모형', () => {
  const rng = mulberry32(4);
  const fair = simulateHistory(1250, rng);
  for (const a of [1, 10, 100]) assert.ok(logBayesFactor(fair, a) < 0, `α=${a} 공정 데이터에서 BF₁₀ < 1`);

  // 번호 1이 매 회차 확률 30%로 나오도록 조작
  const biased = simulateHistory(1250, rng).map((d) => {
    if (d.numbers.includes(1) || rng() > 0.2) return d;
    const nums = [1, ...d.numbers.slice(1)].sort((a, b) => a - b);
    return { numbers: nums, bonus: d.bonus === 1 ? 2 : d.bonus };
  });
  const c = numberCounts(biased);
  assert.ok(c[1] > 300, `조작 확인: 번호 1 출현 ${c[1]}회`);
  assert.ok(logBayesFactor(biased, 10) > 0, '편향 데이터에서 BF₁₀ > 1');
  assert.ok(frequencyUniformityTest(biased).pValue < 0.001, '빈도 검정도 편향 검출');
});

test('엔트로피: 공정한 장기 데이터는 최대 엔트로피에 수렴', () => {
  const e = numberEntropy(simulateHistory(100_000, mulberry32(5)));
  assert.ok(e.efficiency > 0.9999, `효율 ${e.efficiency}`);
  assert.ok(e.klToUniform < 1e-3);
});
