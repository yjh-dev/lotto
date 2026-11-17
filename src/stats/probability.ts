/**
 * 로또 6/45 이론 확률 (귀무가설 H₀: 매 회차 45개 중 6개를 균등·독립 비복원추출)
 * — 관측값과 비교하는 모든 "기대값"의 출처.
 */
import { choose } from './math.ts';

export const N = 45;
export const K = 6;
/** 전체 조합 수 C(45,6) = 8,145,060 */
export const TOTAL_COMBOS = choose(N, K);
/** 한 번호가 한 회차에 뽑힐 확률 p = 6/45 */
export const P_NUMBER = K / N;

/** 초기하분포 P(X = k): 모집단 pop, 성공 succ, 추출 draws */
export function hypergeomPmf(pop: number, succ: number, draws: number, k: number): number {
  return (choose(succ, k) * choose(pop - succ, draws - k)) / choose(pop, draws);
}

/** 내 6개 번호 중 k개 일치 확률: C(6,k)·C(39,6−k)/C(45,6) */
export function matchPmf(k: number): number {
  return hypergeomPmf(N, K, K, k);
}

export interface PrizeOdds {
  rank: 1 | 2 | 3 | 4 | 5;
  label: string;
  /** 유리한 조합 수 */
  combos: number;
  probability: number;
}

/**
 * 등수별 당첨 확률 (보너스 번호 포함)
 *  1등: 6개 일치                          1
 *  2등: 5개 + 나머지 1개가 보너스          C(6,5)·1      = 6
 *  3등: 5개 + 나머지가 보너스 아님         C(6,5)·38     = 228
 *  4등: 4개 일치                          C(6,4)·C(39,2) = 11,115
 *  5등: 3개 일치                          C(6,3)·C(39,3) = 182,780
 */
export function prizeOdds(): PrizeOdds[] {
  const rows: [PrizeOdds['rank'], string, number][] = [
    [1, '6개 일치', 1],
    [2, '5개 + 보너스', choose(6, 5) * 1],
    [3, '5개 일치', choose(6, 5) * (N - K - 1)],
    [4, '4개 일치', choose(6, 4) * choose(N - K, 2)],
    [5, '3개 일치', choose(6, 3) * choose(N - K, 3)],
  ];
  return rows.map(([rank, label, combos]) => ({ rank, label, combos, probability: combos / TOTAL_COMBOS }));
}

// ───────────────────────── 합계 분포 ─────────────────────────

/**
 * 6개 번호 합계의 정확한 분포 (동적계획법으로 6-부분집합 개수 계산).
 * 반환: index = 합계(21~255), 값 = 확률
 */
export function sumDistribution(): number[] {
  const maxSum = 255; // 40+41+…+45
  // ways[k][s] = 합이 s인 k-부분집합 수
  const ways = Array.from({ length: K + 1 }, () => new Array<number>(maxSum + 1).fill(0));
  ways[0][0] = 1;
  for (let x = 1; x <= N; x++) {
    for (let k = Math.min(K, x); k >= 1; k--) {
      for (let s = maxSum; s >= x; s--) ways[k][s] += ways[k - 1][s - x];
    }
  }
  return ways[K].map((w) => w / TOTAL_COMBOS);
}

/**
 * 합계의 이론 모멘트 (유한모집단 비복원추출)
 *  E[S]   = K·(N+1)/2                       = 138
 *  Var[S] = K·σ²·(N−K)/(N−1),  σ² = (N²−1)/12  ≈ 897.07
 */
export function sumMoments(): { mean: number; variance: number; sd: number } {
  const popVar = (N * N - 1) / 12;
  const variance = (K * popVar * (N - K)) / (N - 1);
  return { mean: (K * (N + 1)) / 2, variance, sd: Math.sqrt(variance) };
}

// ───────────────────────── 조합 특성 분포 ─────────────────────────

/** 홀수 개수 분포: 홀수 23개·짝수 22개에서 6개 → 초기하분포 */
export function oddCountPmf(): number[] {
  return Array.from({ length: K + 1 }, (_, k) => hypergeomPmf(N, 23, K, k));
}

/** 저번호(1~22) 개수 분포 → 초기하분포 */
export function lowCountPmf(): number[] {
  return Array.from({ length: K + 1 }, (_, k) => hypergeomPmf(N, 22, K, k));
}

/**
 * 연속번호(차이 1인 쌍)가 하나도 없을 확률.
 * n개 중 이웃하지 않는 k개 선택 수 = C(n−k+1, k)  →  C(40,6)/C(45,6)
 */
export function noConsecutiveProbability(): number {
  return choose(N - K + 1, K) / TOTAL_COMBOS;
}

/**
 * 범위(최댓값 − 최솟값) 분포 — 순서통계량.
 * P(R = r) = (N − r)·C(r−1, K−2) / C(N, K),  r = K−1 … N−1
 * (최솟값 위치 N−r가지 × 양 끝 사이 r−1개 중 K−2개 선택)
 */
export function rangePmf(): number[] {
  const out = new Array<number>(N).fill(0);
  for (let r = K - 1; r <= N - 1; r++) out[r] = ((N - r) * choose(r - 1, K - 2)) / TOTAL_COMBOS;
  return out;
}

/** 직전 회차와 겹치는 번호 수(이월수) 분포 → 초기하분포, 기대값 6·6/45 = 0.8 */
export function overlapPmf(): number[] {
  return Array.from({ length: K + 1 }, (_, k) => hypergeomPmf(N, K, K, k));
}

/**
 * 재출현 간격 분포 — 기하분포 Geometric(p = 6/45), g = 1, 2, …
 * P(G = g) = (1−p)^(g−1)·p.  무기억성: P(G > s+t | G > s) = P(G > t)
 * → "오래 안 나온 번호"라고 다음 회차 출현 확률이 올라가지 않는다.
 */
export function gapPmf(g: number): number {
  return (1 - P_NUMBER) ** (g - 1) * P_NUMBER;
}

/** P(G > g) */
export function gapSF(g: number): number {
  return (1 - P_NUMBER) ** g;
}

// ───────────────────────── 기대값 ─────────────────────────

/** N회차 동안 한 번호의 기대 출현 횟수와 표준편차 — Binomial(N, 6/45) */
export function numberCountMoments(draws: number): { mean: number; sd: number } {
  return { mean: draws * P_NUMBER, sd: Math.sqrt(draws * P_NUMBER * (1 - P_NUMBER)) };
}

/** 특정 번호 쌍이 한 회차에 함께 나올 확률 = C(43,4)/C(45,6) = 30/1980 = 1/66 */
export const P_PAIR = choose(N - 2, K - 2) / TOTAL_COMBOS;
