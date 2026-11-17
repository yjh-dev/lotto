/**
 * 가설검정 — 귀무가설 H₀: "추첨은 균등·독립이다"
 * 적합도(카이제곱, G, KS), 독립성(런, Ljung–Box, 이월수, 간격), 다중비교 보정(Bonferroni, BH).
 */
import { chiSquareSF, ksSF, mean, normalTwoSidedP } from './math.ts';
import { K, N, P_NUMBER, P_PAIR, gapPmf, gapSF } from './probability.ts';
import { numberCounts, pairCounts, type DrawLike } from './descriptive.ts';

export interface TestResult {
  statistic: number;
  df?: number;
  pValue: number;
}

// ───────────────────────── 적합도 ─────────────────────────

/** 피어슨 카이제곱 적합도: X² = Σ (O−E)²/E,  df = 구간 수 − 1 − ddof */
export function chiSquareGOF(observed: readonly number[], expected: readonly number[], ddof = 0): TestResult {
  let x2 = 0;
  for (let i = 0; i < observed.length; i++) x2 += (observed[i] - expected[i]) ** 2 / expected[i];
  const df = observed.length - 1 - ddof;
  return { statistic: x2, df, pValue: chiSquareSF(x2, df) };
}

/** G-검정(우도비): G = 2 Σ O·ln(O/E) ~ χ²(df) */
export function gTest(observed: readonly number[], expected: readonly number[]): TestResult {
  let g = 0;
  for (let i = 0; i < observed.length; i++) if (observed[i] > 0) g += observed[i] * Math.log(observed[i] / expected[i]);
  g *= 2;
  const df = observed.length - 1;
  return { statistic: g, df, pValue: chiSquareSF(g, df) };
}

/**
 * 기대빈도 < minExpected 인 구간을 이웃과 합침 (카이제곱 근사 조건 E ≥ 5).
 * 앞에서부터 누적하다 기준을 넘으면 끊고, 마지막 잔여는 직전 구간에 합침.
 */
export function mergeSmallBins(
  observed: readonly number[],
  expected: readonly number[],
  minExpected = 5,
): { observed: number[]; expected: number[] } {
  const o: number[] = [];
  const e: number[] = [];
  let ao = 0;
  let ae = 0;
  for (let i = 0; i < observed.length; i++) {
    ao += observed[i];
    ae += expected[i];
    if (ae >= minExpected) {
      o.push(ao);
      e.push(ae);
      ao = 0;
      ae = 0;
    }
  }
  if (ae > 0 || ao > 0) {
    if (o.length === 0) {
      o.push(ao);
      e.push(ae);
    } else {
      o[o.length - 1] += ao;
      e[e.length - 1] += ae;
    }
  }
  return { observed: o, expected: e };
}

export interface FrequencyTest extends TestResult {
  /** 보정 전 피어슨 X² */
  rawStatistic: number;
}

/**
 * 번호 출현 빈도 균등성 검정 (비복원추출 보정 포함).
 *
 * 매 회차 6개가 서로 다른 번호이므로 번호별 횟수는 독립이 아니다.
 * 한 회차 지시벡터의 공분산 = p·(N−K)/(N−1)·(I − 11ᵀ/N) 이므로
 *   X² = Σ (O−E)²/E  ~  (N−K)/(N−1) · χ²(N−1) = (39/44)·χ²(44)
 * → 보정 통계량 X²·(N−1)/(N−K) 가 χ²(44)를 따른다.
 * (보정 없이 χ²(44)로 판정하면 p-value가 과대 → 편향을 놓치는 쪽으로 보수적)
 */
export function frequencyUniformityTest(draws: readonly DrawLike[]): FrequencyTest {
  const counts = numberCounts(draws).slice(1);
  const e = draws.length * P_NUMBER;
  let x2 = 0;
  for (const c of counts) x2 += (c - e) ** 2 / e;
  const corrected = (x2 * (N - 1)) / (N - K);
  return { rawStatistic: x2, statistic: corrected, df: N - 1, pValue: chiSquareSF(corrected, N - 1) };
}

/**
 * 번호 쌍 동반출현 검정. 990쌍, 기대 = 회차수/66.
 * 쌍 횟수들 사이의 의존성 때문에 χ² 근사의 자유도가 정확하지 않으므로
 * p-value는 몬테카를로로 보정해서 사용할 것 (simulate.ts).
 */
export function pairStatistic(draws: readonly DrawLike[]): number {
  const e = draws.length * P_PAIR;
  let x2 = 0;
  for (const c of pairCounts(draws).values()) x2 += (c - e) ** 2 / e;
  return x2;
}

/**
 * 이산 분포에 대한 일표본 KS 검정.
 * D = max |F_n(x) − F(x)|. 이산 분포에서 점근 p-value는 보수적(실제보다 큼) → 몬테카를로 병행 권장.
 * @param pmf index = 값, 값 = 확률
 */
export function ksDiscrete(values: readonly number[], pmf: readonly number[]): TestResult {
  const n = values.length;
  const counts = new Array<number>(pmf.length).fill(0);
  for (const v of values) counts[v]++;
  let fe = 0;
  let ft = 0;
  let d = 0;
  for (let x = 0; x < pmf.length; x++) {
    fe += counts[x] / n;
    ft += pmf[x];
    d = Math.max(d, Math.abs(fe - ft));
  }
  return { statistic: d, pValue: ksSF(d, n) };
}

// ───────────────────────── 개별 번호 ─────────────────────────

export interface NumberTest {
  number: number;
  count: number;
  z: number;
  pValue: number;
  /** Bonferroni 보정 p */
  pBonferroni: number;
  /** Benjamini–Hochberg q-value (FDR) */
  qValue: number;
}

/** 번호별 이항검정(정규근사) + 다중비교 보정. 45번 검정하면 우연히 p<0.05가 ~2.25개 나온다. */
export function perNumberTests(draws: readonly DrawLike[]): NumberTest[] {
  const counts = numberCounts(draws);
  const n = draws.length;
  const mu = n * P_NUMBER;
  const sd = Math.sqrt(n * P_NUMBER * (1 - P_NUMBER));
  const raw = Array.from({ length: N }, (_, i) => {
    const z = (counts[i + 1] - mu) / sd;
    return { number: i + 1, count: counts[i + 1], z, pValue: normalTwoSidedP(z) };
  });
  const q = benjaminiHochberg(raw.map((r) => r.pValue));
  return raw.map((r, i) => ({ ...r, pBonferroni: Math.min(1, r.pValue * N), qValue: q[i] }));
}

/** Benjamini–Hochberg q-value: q_(i) = min_{j≥i} (m/j)·p_(j) */
export function benjaminiHochberg(pValues: readonly number[]): number[] {
  const m = pValues.length;
  const order = pValues.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0]);
  const q = new Array<number>(m);
  let running = 1;
  for (let r = m - 1; r >= 0; r--) {
    const [p, idx] = order[r];
    running = Math.min(running, (p * m) / (r + 1));
    q[idx] = running;
  }
  return q;
}

// ───────────────────────── 독립성 ─────────────────────────

/**
 * Wald–Wolfowitz 런 검정: 0/1 수열이 무작위로 섞여 있는가.
 * 런 수 R의 기대 μ = 2·n₀n₁/n + 1, 분산 = (μ−1)(μ−2)/(n−1), 정규근사.
 * 런이 너무 적으면 "몰려 나옴", 너무 많으면 "번갈아 나옴".
 */
export function runsTest(series: ArrayLike<number>): TestResult & { runs: number; expectedRuns: number } {
  const n = series.length;
  let n1 = 0;
  let runs = n > 0 ? 1 : 0;
  for (let i = 0; i < n; i++) {
    if (series[i]) n1++;
    if (i > 0 && series[i] !== series[i - 1]) runs++;
  }
  const n0 = n - n1;
  const mu = (2 * n0 * n1) / n + 1;
  const v = ((mu - 1) * (mu - 2)) / (n - 1);
  const z = v > 0 ? (runs - mu) / Math.sqrt(v) : 0;
  return { statistic: z, pValue: normalTwoSidedP(z), runs, expectedRuns: mu };
}

/** 표본 자기상관 ρ_k, k = 1…maxLag */
export function autocorrelation(series: readonly number[], maxLag: number): number[] {
  const n = series.length;
  const m = mean(series);
  let denom = 0;
  for (const x of series) denom += (x - m) ** 2;
  const out: number[] = [];
  for (let k = 1; k <= maxLag; k++) {
    let num = 0;
    for (let t = k; t < n; t++) num += (series[t] - m) * (series[t - k] - m);
    out.push(num / denom);
  }
  return out;
}

/**
 * Ljung–Box 검정: Q = n(n+2) Σ_{k=1..h} ρ_k²/(n−k) ~ χ²(h)
 * 시계열(예: 회차별 합계)에 시차 상관이 있는지 한 번에 검정.
 */
export function ljungBox(series: readonly number[], lags = 10): TestResult & { acf: number[] } {
  const n = series.length;
  const acf = autocorrelation(series, lags);
  let q = 0;
  acf.forEach((r, i) => (q += (r * r) / (n - (i + 1))));
  q *= n * (n + 2);
  return { statistic: q, df: lags, pValue: chiSquareSF(q, lags), acf };
}

/**
 * 재출현 간격이 기하분포 Geometric(6/45)를 따르는지 카이제곱 검정.
 * 기하분포 = 무기억성 → 통과하면 "오래 안 나온 번호가 곧 나온다"는 근거 없음.
 */
export function gapGeometricTest(gaps: readonly number[], maxGap = 40): TestResult & {
  observed: number[];
  expected: number[];
} {
  const n = gaps.length;
  const obs = new Array<number>(maxGap + 1).fill(0); // 1..maxGap, 마지막 칸 = maxGap 초과
  for (const g of gaps) obs[Math.min(g, maxGap + 1) - 1]++;
  const exp = obs.map((_, i) => (i < maxGap ? gapPmf(i + 1) * n : gapSF(maxGap) * n));
  const merged = mergeSmallBins(obs, exp);
  return { ...chiSquareGOF(merged.observed, merged.expected), observed: obs, expected: exp };
}

/** 관측 정수값들이 이론 pmf를 따르는지 카이제곱 (작은 구간 병합) */
export function discreteGOF(values: readonly number[], pmf: readonly number[]): TestResult & {
  observed: number[];
  expected: number[];
} {
  const obs = new Array<number>(pmf.length).fill(0);
  for (const v of values) obs[v]++;
  const exp = pmf.map((p) => p * values.length);
  const merged = mergeSmallBins(obs, exp);
  return { ...chiSquareGOF(merged.observed, merged.expected), observed: obs, expected: exp };
}
