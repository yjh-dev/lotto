/**
 * 수치 계산 기반: 감마/베타 함수, 주요 분포의 CDF/생존함수, 시드 고정 난수.
 * 외부 라이브러리 없이 구현 (Numerical Recipes, Lanczos 근사 기반).
 */

const EPS = 1e-14;
const FPMIN = 1e-300;
const MAX_ITER = 10_000;

// ───────────────────────── 감마 함수 ─────────────────────────

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** ln Γ(z) — Lanczos 근사 (g=7), 상대오차 ~1e-15 */
export function lnGamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * z))) - lnGamma(1 - z);
  z -= 1;
  let x = LANCZOS[0];
  for (let i = 1; i < 9; i++) x += LANCZOS[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** ln C(n, k) */
export function lnChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1);
}

/** C(n, k) — 정수 연산 (n ≤ 60 정도까지 정확) */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/** 정규화 하부 불완전 감마 P(a, x) */
export function regGammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) return gammaSeries(a, x);
  return 1 - gammaContinuedFraction(a, x);
}

/** 정규화 상부 불완전 감마 Q(a, x) = 1 − P(a, x) (꼬리 정밀도 유지) */
export function regGammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) return 1 - gammaSeries(a, x);
  return gammaContinuedFraction(a, x);
}

function gammaSeries(a: number, x: number): number {
  let ap = a;
  let del = 1 / a;
  let sum = del;
  for (let n = 0; n < MAX_ITER; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}

function gammaContinuedFraction(a: number, x: number): number {
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < MAX_ITER; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

// ───────────────────────── 베타 함수 ─────────────────────────

/** 정규화 불완전 베타 I_x(a, b) */
export function regBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbt = lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  if (x < (a + 1) / (a + b + 2)) return (Math.exp(lbt) * betaContinuedFraction(a, b, x)) / a;
  return 1 - (Math.exp(lbt) * betaContinuedFraction(b, a, 1 - x)) / b;
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Beta(a, b) 분포의 분위수 — 이분법 (단조 CDF이므로 항상 수렴) */
export function betaQuantile(p: number, a: number, b: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (regBeta(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ───────────────────────── 분포 함수 ─────────────────────────

/** 표준정규 CDF Φ(z). erf(x) = P(1/2, x²) 관계 이용 */
export function normalCdf(z: number): number {
  const h = regGammaP(0.5, (z * z) / 2) / 2;
  return z >= 0 ? 0.5 + h : 0.5 - h;
}

/** 양측 정규 p-value: P(|Z| ≥ |z|) */
export function normalTwoSidedP(z: number): number {
  return regGammaQ(0.5, (z * z) / 2);
}

/** 카이제곱 생존함수 P(χ²_df ≥ x) */
export function chiSquareSF(x: number, df: number): number {
  return regGammaQ(df / 2, x / 2);
}

/**
 * 콜모고로프 분포 생존함수 (일표본 KS 검정 p-value 점근 근사).
 * Stephens 보정: λ = (√n + 0.12 + 0.11/√n)·D
 */
export function ksSF(d: number, n: number): number {
  const sn = Math.sqrt(n);
  const lambda = (sn + 0.12 + 0.11 / sn) * d;
  if (lambda < 0.2) return 1;
  let sum = 0;
  let sign = 1;
  for (let k = 1; k <= 100; k++) {
    const term = sign * Math.exp(-2 * k * k * lambda * lambda);
    sum += term;
    if (Math.abs(term) < 1e-16) break;
    sign = -sign;
  }
  return Math.min(1, Math.max(0, 2 * sum));
}

// ───────────────────────── 기초 통계 ─────────────────────────

export function mean(xs: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s / xs.length;
}

/** 표본분산 (n−1) */
export function variance(xs: ArrayLike<number>): number {
  const m = mean(xs);
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += (xs[i] - m) ** 2;
  return s / (xs.length - 1);
}

// ───────────────────────── 난수 ─────────────────────────

export type Rng = () => number;

/** Mulberry32 — 시드 고정 32비트 PRNG, [0, 1) 균등 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 표준정규 난수 (Box–Muller) */
export function normalSample(rng: Rng): number {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Gamma(shape, 1) 난수 — Marsaglia–Tsang (shape<1은 승법 보정) */
export function gammaSample(shape: number, rng: Rng): number {
  if (shape < 1) return gammaSample(shape + 1, rng) * rng() ** (1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normalSample(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

// ───────────────────────── 선형대수 ─────────────────────────

/** A·x = b 풀이 — 부분 피벗 가우스 소거 (A는 n×n, 복사본 사용) */
export function solveLinear(A: readonly number[][], b: readonly number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) throw new Error('특이행렬');
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/** 역행렬 (작은 행렬용: 표준오차 계산) */
export function invert(A: readonly number[][]): number[][] {
  const n = A.length;
  const cols = Array.from({ length: n }, (_, j) => solveLinear(A, Array.from({ length: n }, (_, i) => (i === j ? 1 : 0))));
  return Array.from({ length: n }, (_, i) => cols.map((c) => c[i]));
}
