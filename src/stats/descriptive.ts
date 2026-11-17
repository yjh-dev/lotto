/** 기술통계: 관측 데이터에서 각 특성을 추출 */
import { N, K, numberCountMoments } from './probability.ts';

/** 통계 함수가 요구하는 최소 형식 (실제 Draw와 시뮬레이션 결과 모두 사용) */
export interface DrawLike {
  readonly numbers: readonly number[];
  readonly bonus: number;
}

/** 번호별 출현 횟수. index 1~45 사용 (0은 비움) */
export function numberCounts(draws: readonly DrawLike[], includeBonus = false): number[] {
  const c = new Array<number>(N + 1).fill(0);
  for (const d of draws) {
    for (const n of d.numbers) c[n]++;
    if (includeBonus) c[d.bonus]++;
  }
  return c;
}

export interface NumberStat {
  number: number;
  count: number;
  expected: number;
  /** (관측 − 기대) / 표준편차 — Binomial(N, 6/45) 정규근사 */
  z: number;
  /** 마지막 출현 이후 지난 회차 수 (최신 회차에 나왔으면 0) */
  sinceLast: number;
}

export function numberStats(draws: readonly DrawLike[]): NumberStat[] {
  const counts = numberCounts(draws);
  const { mean, sd } = numberCountMoments(draws.length);
  const lastSeen = new Array<number>(N + 1).fill(-1);
  draws.forEach((d, i) => d.numbers.forEach((n) => (lastSeen[n] = i)));
  const out: NumberStat[] = [];
  for (let n = 1; n <= N; n++) {
    out.push({
      number: n,
      count: counts[n],
      expected: mean,
      z: (counts[n] - mean) / sd,
      sinceLast: lastSeen[n] < 0 ? draws.length : draws.length - 1 - lastSeen[n],
    });
  }
  return out;
}

export const drawSum = (d: DrawLike) => d.numbers.reduce((a, b) => a + b, 0);
export const oddCount = (d: DrawLike) => d.numbers.filter((n) => n % 2 === 1).length;
export const lowCount = (d: DrawLike) => d.numbers.filter((n) => n <= 22).length;

export function drawRange(d: DrawLike): number {
  return Math.max(...d.numbers) - Math.min(...d.numbers);
}

export function hasConsecutive(d: DrawLike): boolean {
  const s = [...d.numbers].sort((a, b) => a - b);
  for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] === 1) return true;
  return false;
}

/** 각 회차가 직전 회차와 겹치는 번호 수 (2회차부터) */
export function overlaps(draws: readonly DrawLike[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < draws.length; i++) {
    const prev = new Set(draws[i - 1].numbers);
    out.push(draws[i].numbers.filter((n) => prev.has(n)).length);
  }
  return out;
}

/**
 * 완결된 재출현 간격 (같은 번호의 연속 출현 사이 회차 차이). 마지막 출현 이후는 중도절단이라 제외.
 */
export function completedGaps(draws: readonly DrawLike[]): number[] {
  const last = new Array<number>(N + 1).fill(-1);
  const gaps: number[] = [];
  draws.forEach((d, i) => {
    for (const n of d.numbers) {
      if (last[n] >= 0) gaps.push(i - last[n]);
      last[n] = i;
    }
  });
  return gaps;
}

/** 번호 i의 회차별 출현 여부 수열 (0/1) */
export function appearanceSeries(draws: readonly DrawLike[], number: number): Uint8Array {
  const s = new Uint8Array(draws.length);
  draws.forEach((d, i) => {
    if (d.numbers.includes(number)) s[i] = 1;
  });
  return s;
}

/** 990개 번호 쌍의 동반 출현 횟수. key = a*100 + b (a<b) */
export function pairCounts(draws: readonly DrawLike[]): Map<number, number> {
  const m = new Map<number, number>();
  for (let a = 1; a <= N; a++) for (let b = a + 1; b <= N; b++) m.set(a * 100 + b, 0);
  for (const d of draws) {
    const s = [...d.numbers].sort((x, y) => x - y);
    for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) {
      const key = s[i] * 100 + s[j];
      m.set(key, m.get(key)! + 1);
    }
  }
  return m;
}

/** 정수 값 배열의 빈도표 (index = 값) */
export function histogram(values: readonly number[], size: number): number[] {
  const h = new Array<number>(size).fill(0);
  for (const v of values) if (v >= 0 && v < size) h[v]++;
  return h;
}
