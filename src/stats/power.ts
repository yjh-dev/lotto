/**
 * 검정력 분석 — "편향이 있었다면 이 데이터로 잡아낼 수 있었나?"
 *
 * 검정에서 "유의하지 않음"은 "편향 없음"의 증명이 아니다. 검정력(1 − 제2종 오류율)이 낮으면
 * 실제 편향이 있어도 놓친다. 그래서 "80% 확률로 잡아낼 수 있는 최소 편향(MDE)"을 함께 보고한다.
 *
 * 대립가설: 번호 하나가 다른 번호보다 (1+δ)배 잘 뽑히는 추첨기 (가중 비복원추출)
 *   그 번호가 한 회차에 뽑힐 확률 (정확식 — 그 번호가 안 뽑히면 남은 공은 모두 가중치 1):
 *     π₁ = 1 − Π_{k=0..5} (44−k) / (44−k+w),  w = 1+δ
 *   나머지 번호: π₀ = (6 − π₁) / 44
 *
 * ① 번호별 검정 (Bonferroni, 45개 양측 α=0.05): 횟수 ~ N(nπ₁, nπ₁(1−π₁)) 정규근사
 * ② 전체 카이제곱 (비복원 보정 ×44/39): 대립가설에서 비중심 χ²(44, λ),
 *     λ = (44/39) · n · Σ (πᵢ − p)² / p
 */
import { chiSquareSF, normalCdf, regGammaQ, lnGamma } from './math.ts';
import { K, N, P_NUMBER } from './probability.ts';

export const ALPHA = 0.05;

/** 가중치 w인 번호 하나가 한 회차 6개 안에 포함될 확률 (정확식) */
export function biasedInclusion(w: number): number {
  let notChosen = 1;
  for (let k = 0; k < K; k++) notChosen *= (N - 1 - k) / (N - 1 - k + w);
  return 1 - notChosen;
}

/** 표준정규 분위수 Φ⁻¹(p) — 이분법 */
export function normalQuantile(p: number): number {
  let lo = -10;
  let hi = 10;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (normalCdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** χ²(df) 상위 α 임계값 */
export function chiSquareCritical(df: number, alpha = ALPHA): number {
  let lo = 0;
  let hi = df + 50 * Math.sqrt(2 * df) + 100;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (chiSquareSF(mid, df) > alpha) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * 비중심 카이제곱 생존함수 — 포아송 혼합:
 *   P(χ'²(df, λ) > x) = Σ_j e^{−λ/2} (λ/2)^j / j! · Q((df+2j)/2, x/2)
 */
export function noncentralChiSquareSF(x: number, df: number, lambda: number): number {
  if (lambda <= 0) return chiSquareSF(x, df);
  const half = lambda / 2;
  const jMax = Math.ceil(half + 12 * Math.sqrt(half) + 60);
  let s = 0;
  for (let j = 0; j <= jMax; j++) {
    const logW = -half + j * Math.log(half) - lnGamma(j + 1);
    s += Math.exp(logW) * regGammaQ((df + 2 * j) / 2, x / 2);
  }
  return Math.min(1, s);
}

export interface PowerRow {
  /** 편향 δ (0.2 = 20% 더 잘 뽑힘) */
  bias: number;
  /** 편향된 번호의 회차당 출현 확률 */
  inclusion: number;
  /** 전체 카이제곱 검정 검출 확률 */
  omnibus: number;
  /** 번호별 검정(Bonferroni) 검출 확률 */
  perNumber: number;
}

export function biasPower(draws: number, bias: number, alpha = ALPHA): PowerRow {
  const p = P_NUMBER;
  const pi1 = biasedInclusion(1 + bias);
  const pi0 = (K - pi1) / (N - 1);

  // ① 번호별 Bonferroni (양측)
  const z = normalQuantile(1 - alpha / (2 * N));
  const mu0 = draws * p;
  const sd0 = Math.sqrt(draws * p * (1 - p));
  const mu1 = draws * pi1;
  const sd1 = Math.sqrt(draws * pi1 * (1 - pi1));
  const perNumber = 1 - normalCdf((mu0 + z * sd0 - mu1) / sd1) + normalCdf((mu0 - z * sd0 - mu1) / sd1);

  // ② 보정 카이제곱
  const lambda = ((N - 1) / (N - K)) * draws * (((pi1 - p) ** 2) / p + ((N - 1) * (pi0 - p) ** 2) / p);
  const omnibus = noncentralChiSquareSF(chiSquareCritical(N - 1, alpha), N - 1, lambda);

  return { bias, inclusion: pi1, omnibus, perNumber };
}

/** 목표 검정력(기본 80%)을 달성하는 최소 편향 δ — 이분법 */
export function minimumDetectableBias(draws: number, test: 'omnibus' | 'perNumber', target = 0.8): number {
  let lo = 0;
  let hi = 10;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (biasPower(draws, mid)[test] < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface PowerAnalysis {
  draws: number;
  alpha: number;
  rows: PowerRow[];
  /** 80% 검정력 최소 검출 편향 */
  mdePerNumber: number;
  mdeOmnibus: number;
  /** 회차 수가 늘면 MDE가 어떻게 줄어드는지 (참고) */
  byDraws: { draws: number; mdePerNumber: number }[];
}

export function powerAnalysis(draws: number): PowerAnalysis {
  return {
    draws,
    alpha: ALPHA,
    rows: [0.05, 0.1, 0.2, 0.3, 0.5].map((b) => biasPower(draws, b)),
    mdePerNumber: minimumDetectableBias(draws, 'perNumber'),
    mdeOmnibus: minimumDetectableBias(draws, 'omnibus'),
    byDraws: [draws, draws * 2, draws * 4, draws * 10].map((n) => ({ draws: n, mdePerNumber: minimumDetectableBias(n, 'perNumber') })),
  };
}
