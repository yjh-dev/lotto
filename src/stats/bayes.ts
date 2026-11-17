/**
 * 베이지안 추론 — 디리클레–다항 켤레 모형
 *
 * 모형: 뽑힌 공 하나하나를 범주형 θ = (θ₁…θ₄₅)에서 나온 것으로 본다.
 *   사전분포  θ ~ Dirichlet(α, …, α)
 *   사후분포  θ | 데이터 ~ Dirichlet(α + c₁, …, α + c₄₅)
 *   주변분포  θᵢ | 데이터 ~ Beta(α + cᵢ, Σα + n − α − cᵢ)
 *
 * 근사 주의: 실제로는 회차 내 비복원추출이라 공들이 완전 독립이 아니다.
 * 이 의존성은 분산을 줄이는 방향(39/44배)이므로, 다항 모형은 편향 증거를 약간 과대평가 —
 * 즉 이 모형에서 "균등" 결론이 나오면 실제로는 더 강하게 균등이다.
 */
import { betaQuantile, lnGamma } from './math.ts';
import { K, N } from './probability.ts';
import { numberCounts, type DrawLike } from './descriptive.ts';

export interface PosteriorNumber {
  number: number;
  count: number;
  /** 사후평균 E[θᵢ] */
  mean: number;
  /** 95% 신용구간 */
  lower: number;
  upper: number;
  /** 다음 회차에 이 번호가 나올 확률 근사 ≈ 6·E[θᵢ] (균등이면 13.33%) */
  nextDrawProb: number;
}

export function dirichletPosterior(draws: readonly DrawLike[], alpha = 1, level = 0.95): PosteriorNumber[] {
  const counts = numberCounts(draws).slice(1);
  const total = counts.reduce((a, b) => a + b, 0);
  const a0 = alpha * N + total;
  const tail = (1 - level) / 2;
  return counts.map((c, i) => {
    const a = alpha + c;
    const b = a0 - a;
    const m = a / a0;
    return {
      number: i + 1,
      count: c,
      mean: m,
      lower: betaQuantile(tail, a, b),
      upper: betaQuantile(1 - tail, a, b),
      nextDrawProb: K * m,
    };
  });
}

/**
 * 베이즈 인자 log BF₁₀ = log p(데이터 | 편향 모형 M₁) − log p(데이터 | 균등 모형 M₀)
 *   M₀: θ = (1/45, …)               → log p = n·ln(1/45)
 *   M₁: θ ~ Dirichlet(α)            → log p = lnΓ(Nα) − lnΓ(Nα+n) + Σ[lnΓ(α+cᵢ) − lnΓ(α)]
 * α가 작을수록 "큰 편향"을, 클수록 "미세한 편향"을 가정. 여러 α로 민감도 확인.
 */
export function logBayesFactor(draws: readonly DrawLike[], alpha: number): number {
  const counts = numberCounts(draws).slice(1);
  const n = counts.reduce((a, b) => a + b, 0);
  let lm1 = lnGamma(N * alpha) - lnGamma(N * alpha + n);
  for (const c of counts) lm1 += lnGamma(alpha + c) - lnGamma(alpha);
  const lm0 = n * Math.log(1 / N);
  return lm1 - lm0;
}

/** Kass & Raftery(1995) 척도로 BF₁₀ 해석 */
export function interpretBayesFactor(logBF10: number): string {
  const log10 = logBF10 / Math.LN10;
  const abs = Math.abs(log10);
  const strength = abs < 0.5 ? '거의 없음' : abs < 1 ? '약함' : abs < 2 ? '강함' : '결정적';
  if (abs < 0.5) return '두 모형 구분 불가';
  return `${log10 > 0 ? '편향 모형' : '균등 모형'} 지지 (${strength})`;
}
