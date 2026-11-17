/** 검정력 공식 ↔ 가중 추첨 시뮬레이션 교차검증 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from './math.ts';
import { frequencyUniformityTest } from './hypothesis.ts';
import { numberCounts } from './descriptive.ts';
import { biasPower, biasedInclusion, chiSquareCritical, minimumDetectableBias, noncentralChiSquareSF } from './power.ts';
import { chiSquareSF, normalCdf } from './math.ts';

const close = (a: number, b: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≉ ${b} (tol ${tol})`);

/** 번호 1만 가중치 w인 비복원 가중 추첨 */
function weightedHistory(n: number, w: number, rng: () => number) {
  const out = [];
  for (let t = 0; t < n; t++) {
    const avail = Array.from({ length: 45 }, (_, i) => i + 1);
    const nums: number[] = [];
    for (let k = 0; k < 6; k++) {
      const tot = avail.reduce((a, x) => a + (x === 1 ? w : 1), 0);
      let u = rng() * tot;
      let j = 0;
      while ((u -= avail[j] === 1 ? w : 1) > 0) j++;
      nums.push(avail.splice(j, 1)[0]);
    }
    out.push({ numbers: nums, bonus: 0 });
  }
  return out;
}

test('편향 번호 포함 확률: 정확식 = 시뮬레이션', () => {
  close(biasedInclusion(1), 6 / 45, 1e-12, 'w=1이면 6/45');
  const rng = mulberry32(1);
  const h = weightedHistory(40_000, 1.3, rng);
  close(numberCounts(h)[1] / h.length, biasedInclusion(1.3), 0.005);
});

test('비중심 카이제곱: λ=0이면 중심, 알려진 값', () => {
  close(noncentralChiSquareSF(60.48, 44, 0), chiSquareSF(60.48, 44), 1e-12);
  close(chiSquareCritical(44), 60.48088598, 1e-5);
  // ncχ²(df=1, λ=4) = (Z+2)²  →  P(> c²) = Φ(2−c) + Φ(−2−c)
  const c = 1.959964;
  close(noncentralChiSquareSF(c ** 2, 1, 4), normalCdf(2 - c) + normalCdf(-2 - c), 1e-9);
});

test('검정력 공식 ↔ 시뮬레이션 (1250회, 번호 하나 ×1.3)', () => {
  const rng = mulberry32(2);
  const reps = 400;
  let omni = 0;
  let one = 0;
  for (let i = 0; i < reps; i++) {
    const h = weightedHistory(1250, 1.3, rng);
    if (frequencyUniformityTest(h).pValue < 0.05) omni++;
    const c = numberCounts(h)[1];
    const mu = (1250 * 6) / 45;
    if (Math.abs((c - mu) / Math.sqrt((mu * 39) / 45)) > 3.2608) one++;
  }
  const th = biasPower(1250, 0.3);
  const tol = 3 * Math.sqrt(0.25 / reps) + 0.03;
  close(omni / reps, th.omnibus, tol, '전체 카이제곱');
  close(one / reps, th.perNumber, tol, '번호별');
});

test('최소 검출 편향: 회차가 4배면 대략 절반 (√n 법칙)', () => {
  const a = minimumDetectableBias(1250, 'perNumber');
  const b = minimumDetectableBias(5000, 'perNumber');
  assert.ok(biasPower(1250, a).perNumber > 0.79 && biasPower(1250, a).perNumber < 0.81);
  close(b / a, 0.5, 0.06);
});
