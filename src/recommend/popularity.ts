/**
 * 번호별 구매자 인기도 — 동점일 때 비인기 조합을 고르는 데만 사용 (당첨 확률과 무관)
 *
 * 5등(3개 일치) 당첨자 수는 판매량 × P(5등)이 기대값이고, 사람들이 많이 고른 번호가 나온 회차일수록 기대보다 많다.
 *   y = ln(5등 당첨자 / 기대 5등 당첨자) ≈ a + Σ_{n∈당첨번호} βₙ   (능형 회귀, λ로 수축)
 * βₙ > 0 이면 많이 고르는 번호. 조합 점수 s(c) = Σ βₙ, 인기도 배수 m(c) = e^{s(c)} / E_무작위[e^{s}]
 * 검증: 1~1000회로 학습 → 1001~1250회 예측과 실제의 상관 0.52 (번호 순위는 미래에도 유지)
 * 한계: 5등 기준 추정. 1~3등 공동 당첨자 수에도 같은 비율로 적용된다는 가정이며 그 효과는 확인되지 않음
 */
import { mulberry32, solveLinear } from '../stats/math.ts';
import { simulateDraw } from '../stats/simulate.ts';
import { TOTAL_COMBOS } from '../stats/probability.ts';

const P5 = 182_780 / TOTAL_COMBOS;
export const POPULARITY_LAMBDA = 50;

export interface NumberPopularity {
  /** index 1~45 (0은 절편) */
  beta: number[];
  rows: number;
  /** 무작위 조합의 E[e^s] — 배수 정규화 */
  norm: number;
}

export function fitNumberPopularity(
  draws: readonly { numbers: readonly number[]; totalSales: number; prizes: readonly { winners: number }[] }[],
  lambda = POPULARITY_LAMBDA,
): NumberPopularity {
  const A = Array.from({ length: 46 }, () => new Array(46).fill(0));
  const b = new Array(46).fill(0);
  let rows = 0;
  for (const d of draws) {
    const w5 = d.prizes[4]?.winners ?? 0;
    if (!(d.totalSales > 0) || !(w5 > 0)) continue;
    const y = Math.log(w5 / ((d.totalSales / 1000) * P5));
    const idx = [0, ...d.numbers];
    for (const i of idx) {
      b[i] += y;
      for (const j of idx) A[i][j] += 1;
    }
    rows++;
  }
  for (let i = 1; i < 46; i++) A[i][i] += lambda;
  const beta = rows ? solveLinear(A, b) : new Array(46).fill(0);
  const rng = mulberry32(41);
  let s = 0;
  const N = 20_000;
  for (let i = 0; i < N; i++) s += Math.exp(simulateDraw(rng).numbers.reduce((a, n) => a + beta[n], 0));
  return { beta, rows, norm: s / N };
}

/** 조합 점수 (클수록 많이 고르는 조합) */
export const comboScore = (p: NumberPopularity, nums: readonly number[]) => nums.reduce((a, n) => a + p.beta[n], 0);
/** 평균 조합 대비 인기도 배수 (1보다 작으면 덜 고르는 조합 → 당첨 시 나눌 사람이 적을 것으로 추정) */
export const comboMultiplier = (p: NumberPopularity, nums: readonly number[]) => Math.exp(comboScore(p, nums)) / p.norm;
