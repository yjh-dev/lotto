/**
 * 몬테카를로 시뮬레이션 — "공정한 로또"를 컴퓨터로 재현해 통계량의 귀무분포를 직접 만든다.
 * 이론 근사(χ², KS 점근식)가 부정확한 경우에도 정확한 p-value를 준다 (모수적 부트스트랩).
 */
import { mulberry32, type Rng } from './math.ts';
import { K, N } from './probability.ts';
import type { DrawLike } from './descriptive.ts';

/** 1~45에서 비복원으로 6개 + 보너스 1개 (부분 Fisher–Yates) */
export function simulateDraw(rng: Rng, pool: number[] = Array.from({ length: N }, (_, i) => i + 1)): DrawLike {
  for (let i = 0; i <= K; i++) {
    const j = i + Math.floor(rng() * (N - i));
    const t = pool[i];
    pool[i] = pool[j];
    pool[j] = t;
  }
  return { numbers: pool.slice(0, K).sort((a, b) => a - b), bonus: pool[K] };
}

export function simulateHistory(draws: number, rng: Rng): DrawLike[] {
  const pool = Array.from({ length: N }, (_, i) => i + 1);
  return Array.from({ length: draws }, () => simulateDraw(rng, pool));
}

/**
 * 통계량의 귀무분포: 같은 길이의 공정한 역사를 iterations번 생성해 통계량 계산.
 */
export function nullDistribution(
  statistic: (history: DrawLike[]) => number,
  draws: number,
  iterations: number,
  seed = 20021207,
): number[] {
  const rng = mulberry32(seed);
  const out = new Array<number>(iterations);
  for (let i = 0; i < iterations; i++) out[i] = statistic(simulateHistory(draws, rng));
  return out;
}

/**
 * 경험적 p-value = (#{null ≥ obs} + 1) / (iterations + 1)  — +1 보정으로 0이 나오지 않게.
 * tail: 'greater'(큰 값이 극단), 'less', 'two-sided'(중앙값 기준 양측)
 */
export function empiricalPValue(
  observed: number,
  nullDist: readonly number[],
  tail: 'greater' | 'less' | 'two-sided' = 'greater',
): number {
  const n = nullDist.length;
  const ge = nullDist.filter((x) => x >= observed).length;
  const le = nullDist.filter((x) => x <= observed).length;
  if (tail === 'greater') return (ge + 1) / (n + 1);
  if (tail === 'less') return (le + 1) / (n + 1);
  return Math.min(1, (2 * Math.min(ge, le) + 1) / (n + 1));
}

/** 관측값이 귀무분포에서 몇 번째 백분위인지 (0~100) */
export function percentile(observed: number, nullDist: readonly number[]): number {
  return (100 * nullDist.filter((x) => x < observed).length) / nullDist.length;
}
