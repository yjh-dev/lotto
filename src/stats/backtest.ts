/**
 * 워크포워드 백테스트 (시계열 교차검증)
 *
 * t회차를 예측할 때 1 ~ t−1회차 데이터만 사용 → 미래 정보 누출 없음.
 * 각 전략이 고른 6개와 실제 당첨번호의 일치 개수를 기록하고, 실제 당첨금으로 수익률 계산.
 *
 * 이론: 추첨이 과거와 독립이면 어떤 전략이든 일치 개수 ~ 초기하분포(45, 6, 6)
 *       → 평균 0.8, 분산 6·(6/45)·(39/45)·(39/44) ≈ 0.6145
 */
import { gammaSample, mulberry32, normalTwoSidedP, type Rng } from './math.ts';
import { K, N, matchPmf } from './probability.ts';
import { benjaminiHochberg, chiSquareGOF, mergeSmallBins } from './hypothesis.ts';
import type { DrawLike } from './descriptive.ts';

/** 전략이 참고할 수 있는 과거 정보 (매 회차 점진 갱신) */
export interface BacktestContext {
  /** 지금까지 회차 수 */
  seen: number;
  /** 전체 기간 번호별 출현 횟수 (index 1~45) */
  counts: number[];
  /** 최근 RECENT_WINDOW 회차 출현 횟수 */
  recentCounts: number[];
  /** 마지막 출현 이후 경과 회차 */
  sinceLast: number[];
  previous: readonly number[] | null;
}

export const RECENT_WINDOW = 50;

export interface Strategy {
  key: string;
  name: string;
  description: string;
  pick(ctx: BacktestContext, rng: Rng): number[];
}

/** score 기준 상위 k개 번호 (동점은 무작위) */
function topK(score: (n: number) => number, rng: Rng, k = K): number[] {
  return Array.from({ length: N }, (_, i) => ({ n: i + 1, s: score(i + 1), r: rng() }))
    .sort((a, b) => b.s - a.s || a.r - b.r)
    .slice(0, k)
    .map((x) => x.n)
    .sort((a, b) => a - b);
}

export const STRATEGIES: Strategy[] = [
  {
    key: 'random',
    name: '무작위',
    description: '균등 무작위 6개 (기준선)',
    pick: (_c, rng) => topK(() => 0, rng),
  },
  {
    key: 'hot',
    name: '핫 번호 (전체)',
    description: '전체 기간 최다 출현 6개',
    pick: (c, rng) => topK((n) => c.counts[n], rng),
  },
  {
    key: 'hot50',
    name: `핫 번호 (최근 ${RECENT_WINDOW}회)`,
    description: `최근 ${RECENT_WINDOW}회 최다 출현 6개`,
    pick: (c, rng) => topK((n) => c.recentCounts[n], rng),
  },
  {
    key: 'cold',
    name: '콜드 번호',
    description: '전체 기간 최소 출현 6개 ("평균 회귀" 기대)',
    pick: (c, rng) => topK((n) => -c.counts[n], rng),
  },
  {
    key: 'overdue',
    name: '미출현 번호',
    description: '가장 오래 안 나온 6개 (도박사의 오류 검증)',
    pick: (c, rng) => topK((n) => c.sinceLast[n], rng),
  },
  {
    key: 'repeat',
    name: '직전 회차 반복',
    description: '지난 회차 당첨번호 그대로',
    pick: (c, rng) => (c.previous ? [...c.previous] : topK(() => 0, rng)),
  },
  {
    key: 'thompson',
    name: '베이지안 톰슨 샘플링',
    description: 'θ ~ Dirichlet(1 + 출현횟수)에서 표본 추출 후 상위 6개',
    pick: (c, rng) => {
      const theta = c.counts.map((x, i) => (i === 0 ? -1 : gammaSample(1 + x, rng)));
      return topK((n) => theta[n], rng);
    },
  },
];

export interface StrategyResult {
  key: string;
  name: string;
  description: string;
  games: number;
  meanMatches: number;
  /** 일치 개수 분포 0~6 */
  matchHistogram: number[];
  /** 등수별 당첨 횟수 [1등..5등] */
  rankHits: number[];
  /** 평균 일치가 이론값 0.8과 다른지 — z검정 */
  z: number;
  pValue: number;
  /** 일치 개수 분포가 초기하분포를 따르는지 — 카이제곱 */
  distributionP: number;
  /** BH 보정 (전략 수만큼 검정했으므로) */
  qValue: number;
  /** 실제 당첨금 기준 총 수령액 / 총 구매액 */
  returnRate: number;
  spent: number;
  won: number;
  /** 회차별 누적 평균 일치 (그래프용) */
  cumulativeMean: number[];
}

export interface BacktestOptions {
  /** 이 회차부터 평가 (기본 262: 판매액·가격 체계가 안정된 이후) */
  startRound?: number;
  /** 이 회차까지 평가 (기본: 끝까지). 기간 선택용 */
  endRound?: number;
  seed?: number;
  pricePerGame?: number;
}

type DrawWithPrize = DrawLike & { round: number; prizes?: { amount: number }[] };

export const MATCH_MEAN = 0.8;
export const MATCH_VAR = 6 * (6 / 45) * (39 / 45) * (39 / 44);

/** 일치 개수 + 보너스로 등수 판정 (0 = 낙첨) */
export function prizeRank(pick: readonly number[], draw: DrawLike): number {
  const set = new Set(draw.numbers);
  const m = pick.filter((n) => set.has(n)).length;
  if (m === 6) return 1;
  if (m === 5) return pick.includes(draw.bonus) ? 2 : 3;
  if (m === 4) return 4;
  if (m === 3) return 5;
  return 0;
}

export function runBacktest(
  draws: readonly DrawWithPrize[],
  strategies: Strategy[] = STRATEGIES,
  opts: BacktestOptions = {},
): StrategyResult[] {
  const startRound = opts.startRound ?? 262;
  const endRound = opts.endRound ?? Infinity;
  const price = opts.pricePerGame ?? 1000;

  const results = strategies.map((s, si) => {
    const rng = mulberry32((opts.seed ?? 7) + si * 1000);
    const ctx: BacktestContext = {
      seen: 0,
      counts: new Array(N + 1).fill(0),
      recentCounts: new Array(N + 1).fill(0),
      sinceLast: new Array(N + 1).fill(0),
      previous: null,
    };
    const hist = new Array(K + 1).fill(0);
    const rankHits = [0, 0, 0, 0, 0];
    const cumulativeMean: number[] = [];
    let total = 0;
    let games = 0;
    let won = 0;

    draws.forEach((d, i) => {
      if (d.round >= startRound && d.round <= endRound) {
        const pick = s.pick(ctx, rng);
        const set = new Set(d.numbers);
        const m = pick.filter((n) => set.has(n)).length;
        hist[m]++;
        total += m;
        games++;
        cumulativeMean.push(total / games);
        const rank = prizeRank(pick, d);
        if (rank > 0) {
          rankHits[rank - 1]++;
          won += d.prizes?.[rank - 1]?.amount ?? 0;
        }
      }
      // 컨텍스트 갱신 (이 회차 결과는 다음 회차부터 사용)
      ctx.seen++;
      for (let n = 1; n <= N; n++) ctx.sinceLast[n]++;
      for (const n of d.numbers) {
        ctx.counts[n]++;
        ctx.recentCounts[n]++;
        ctx.sinceLast[n] = 0;
      }
      if (i >= RECENT_WINDOW) for (const n of draws[i - RECENT_WINDOW].numbers) ctx.recentCounts[n]--;
      ctx.previous = d.numbers;
    });

    const mean = games ? total / games : NaN;
    const z = (mean - MATCH_MEAN) / Math.sqrt(MATCH_VAR / games);
    const merged = mergeSmallBins(hist, hist.map((_, k) => matchPmf(k) * games));
    return {
      key: s.key,
      name: s.name,
      description: s.description,
      games,
      meanMatches: mean,
      matchHistogram: hist,
      rankHits,
      z,
      pValue: normalTwoSidedP(z),
      distributionP: chiSquareGOF(merged.observed, merged.expected).pValue,
      qValue: 1,
      returnRate: won / (games * price),
      spent: games * price,
      won,
      cumulativeMean,
    };
  });

  const q = benjaminiHochberg(results.map((r) => r.pValue));
  results.forEach((r, i) => (r.qValue = q[i]));
  return results;
}
