/**
 * 전체 분석 실행기 — 대시보드와 리포트가 공통으로 사용하는 결과 객체를 만든다.
 */
import {
  lowCountPmf, noConsecutiveProbability, numberCountMoments, oddCountPmf, overlapPmf, prizeOdds, rangePmf,
  sumDistribution, sumMoments,
} from './probability.ts';
import { normalTwoSidedP } from './math.ts';
import {
  appearanceSeries, completedGaps, drawRange, drawSum, hasConsecutive, lowCount, numberCounts, numberStats, oddCount,
  overlaps, type DrawLike, type NumberStat,
} from './descriptive.ts';
import {
  benjaminiHochberg, chiSquareGOF, discreteGOF, frequencyUniformityTest, gapGeometricTest, gTest, ksDiscrete, ljungBox,
  pairStatistic, perNumberTests, runsTest, type FrequencyTest, type NumberTest, type TestResult,
} from './hypothesis.ts';
import { dirichletPosterior, interpretBayesFactor, logBayesFactor, type PosteriorNumber } from './bayes.ts';
import { numberEntropy, COMBO_ENTROPY_BITS, type EntropyResult } from './information.ts';
import { empiricalPValue, nullDistribution, percentile } from './simulate.ts';
import { powerAnalysis, type PowerAnalysis } from './power.ts';

export interface EraAnalysis {
  /** 구간별 번호 빈도 균등성 (보정 카이제곱) */
  segments: { from: number; to: number; draws: number; pValue: number; qValue: number }[];
  /** 구간 간 번호 분포가 같은가 — 45×구간 분할표 X², 몬테카를로 p */
  homogeneity: McResult;
  /** 최근 100회만의 균등성 */
  recent: { draws: number; from: number; pValue: number };
}

export const ERA_BLOCKS = 5;

function blockBounds(n: number, blocks: number): [number, number][] {
  const size = Math.floor(n / blocks);
  return Array.from({ length: blocks }, (_, b) => [b * size, b === blocks - 1 ? n : (b + 1) * size]);
}

/** 분할표 동질성 X² = ΣΣ (O − E)²/E,  E = 번호 전체 횟수 × 구간 비중 */
export function eraHomogeneityStatistic(h: readonly DrawLike[], blocks = ERA_BLOCKS): number {
  const bounds = blockBounds(h.length, blocks);
  const tab = bounds.map(([a, b]) => numberCounts(h.slice(a, b)).slice(1));
  const share = bounds.map(([a, b]) => (b - a) / h.length);
  let x2 = 0;
  for (let i = 0; i < 45; i++) {
    const tot = tab.reduce((acc, r) => acc + r[i], 0);
    tab.forEach((r, bi) => {
      const e = tot * share[bi];
      if (e > 0) x2 += (r[i] - e) ** 2 / e;
    });
  }
  return x2;
}

export interface McResult {
  observed: number;
  pValue: number;
  percentile: number;
  /** 히스토그램용 귀무분포 표본 */
  nullSample: number[];
}

export interface Analysis {
  drawCount: number;
  firstRound: number;
  lastRound: number;
  probability: { prizes: ReturnType<typeof prizeOdds>; comboEntropyBits: number };
  numbers: { stats: NumberStat[]; tests: NumberTest[]; expected: number; sd: number };
  frequency: FrequencyTest & { gTest: TestResult; monteCarlo: McResult };
  maxAbsZ: McResult;
  pairs: McResult;
  sum: {
    values: number[];
    theory: ReturnType<typeof sumMoments>;
    pmf: number[];
    ks: TestResult;
    ksMonteCarlo: McResult;
    ljungBox: ReturnType<typeof ljungBox>;
    /** 점근 χ²는 표본이 작으면 과대 기각(50회에서 α=0.01이 2.25%) → 몬테카를로 p를 판정에 사용 */
    ljungBoxMonteCarlo: McResult;
  };
  oddEven: ReturnType<typeof discreteGOF>;
  lowHigh: ReturnType<typeof discreteGOF>;
  range: ReturnType<typeof discreteGOF>;
  consecutive: { observedRate: number; theoryRate: number; z: number; pValue: number };
  overlap: ReturnType<typeof discreteGOF> & { mean: number };
  gaps: ReturnType<typeof gapGeometricTest> & { count: number; mean: number };
  runs: { number: number; runs: number; expected: number; z: number; pValue: number; qValue: number }[];
  bayes: {
    posterior: PosteriorNumber[];
    bayesFactors: { alpha: number; logBF10: number; interpretation: string }[];
  };
  entropy: EntropyResult;
  /**
   * 보너스 번호: 회차마다 남은 39개 중 1개를 뽑지만, 주변분포는 45개 균등(1/45)이고 회차끼리 독립
   * → 번호별 횟수 ~ 다항분포(n, 1/45), 통상의 χ²(44)가 정확히 적용됨
   */
  bonus: { counts: number[]; expected: number; test: TestResult };
  /** 검정력: 이 데이터로 잡아낼 수 있는 편향 크기 */
  power: PowerAnalysis;
  /** 시기별 안정성 (추첨기·공 교체 등으로 특정 시기만 편향됐는지) */
  eras: EraAnalysis;
  /** 주요 검정 묶음 + 검정 전체에 대한 BH 보정 (검정을 많이 하면 우연한 p<0.05가 생김) */
  summary: SummaryRow[];
}

export interface SummaryRow {
  key: string;
  name: string;
  /** 적용 이론 */
  theory: string;
  pValue: number;
  qValue: number;
}

export interface AnalysisOptions {
  /** 몬테카를로 반복 수 (기본 1000 — 경험적 p-value 해상도 ≈ 0.001) */
  iterations?: number;
  seed?: number;
}

export function runAnalysis(draws: readonly (DrawLike & { round?: number })[], opts: AnalysisOptions = {}): Analysis {
  const iterations = opts.iterations ?? 1000;
  const seed = opts.seed ?? 20021207;
  const n = draws.length;
  const list: readonly DrawLike[] = draws;

  const mc = (stat: (h: DrawLike[]) => number, tail: 'greater' | 'two-sided' = 'greater', s = seed): McResult => {
    const observed = stat([...list]);
    const nullSample = nullDistribution(stat, n, iterations, s);
    return { observed, pValue: empiricalPValue(observed, nullSample, tail), percentile: percentile(observed, nullSample), nullSample };
  };

  const { mean: expected, sd } = numberCountMoments(n);
  const counts = numberCounts(list).slice(1);

  // 합계: 이산 KS + 몬테카를로 보정
  const sumPmf = sumDistribution();
  const sums = list.map(drawSum);
  const ksStat = (h: DrawLike[]) => ksDiscrete(h.map(drawSum), sumPmf).statistic;

  const ov = overlaps(list);
  const gaps = completedGaps(list);

  const runsRaw = Array.from({ length: 45 }, (_, i) => {
    const r = runsTest(appearanceSeries(list, i + 1));
    return { number: i + 1, runs: r.runs, expected: r.expectedRuns, z: r.statistic, pValue: r.pValue };
  });
  const runsQ = benjaminiHochberg(runsRaw.map((r) => r.pValue));

  const consecObs = list.filter(hasConsecutive).length / n;
  const consecTheory = 1 - noConsecutiveProbability();
  const consecZ = (consecObs - consecTheory) / Math.sqrt((consecTheory * (1 - consecTheory)) / n);

  const result: Omit<Analysis, 'summary'> = {
    drawCount: n,
    firstRound: draws[0].round ?? 1,
    lastRound: draws[n - 1].round ?? n,
    probability: { prizes: prizeOdds(), comboEntropyBits: COMBO_ENTROPY_BITS },
    numbers: { stats: numberStats(list), tests: perNumberTests(list), expected, sd },
    frequency: {
      ...frequencyUniformityTest(list),
      gTest: gTest(counts, counts.map(() => expected)),
      monteCarlo: mc((h) => frequencyUniformityTest(h).rawStatistic, 'greater', seed + 1),
    },
    maxAbsZ: mc((h) => Math.max(...numberStats(h).map((s) => Math.abs(s.z))), 'greater', seed + 2),
    pairs: mc(pairStatistic, 'greater', seed + 3),
    sum: {
      values: sums,
      theory: sumMoments(),
      pmf: sumPmf,
      ks: ksDiscrete(sums, sumPmf),
      ksMonteCarlo: mc(ksStat, 'greater', seed + 4),
      ljungBox: ljungBox(sums, 10),
      ljungBoxMonteCarlo: mc((h) => ljungBox(h.map(drawSum), 10).statistic, 'greater', seed + 6),
    },
    oddEven: discreteGOF(list.map(oddCount), oddCountPmf()),
    lowHigh: discreteGOF(list.map(lowCount), lowCountPmf()),
    range: discreteGOF(list.map(drawRange), rangePmf()),
    consecutive: {
      observedRate: consecObs,
      theoryRate: consecTheory,
      z: consecZ,
      pValue: normalTwoSidedP(consecZ),
    },
    overlap: { ...discreteGOF(ov, overlapPmf()), mean: ov.reduce((a, b) => a + b, 0) / ov.length },
    gaps: { ...gapGeometricTest(gaps), count: gaps.length, mean: gaps.reduce((a, b) => a + b, 0) / gaps.length },
    runs: runsRaw.map((r, i) => ({ ...r, qValue: runsQ[i] })),
    bayes: {
      posterior: dirichletPosterior(list, 1),
      bayesFactors: [1, 10, 100, 1000].map((alpha) => {
        const l = logBayesFactor(list, alpha);
        return { alpha, logBF10: l, interpretation: interpretBayesFactor(l) };
      }),
    },
    entropy: numberEntropy(list),
    bonus: (() => {
      const counts = new Array<number>(46).fill(0);
      for (const d of list) counts[d.bonus]++;
      const e = n / 45;
      return { counts, expected: e, test: chiSquareGOF(counts.slice(1), counts.slice(1).map(() => e)) };
    })(),
    power: powerAnalysis(n),
    eras: (() => {
      const bounds = blockBounds(n, ERA_BLOCKS);
      const raw = bounds.map(([x, y]) => {
        const seg = list.slice(x, y) as (DrawLike & { round?: number })[];
        return { from: seg[0].round ?? x + 1, to: seg.at(-1)!.round ?? y, draws: seg.length, pValue: frequencyUniformityTest(seg).pValue };
      });
      const q = benjaminiHochberg(raw.map((r) => r.pValue));
      const recentDraws = list.slice(-100) as (DrawLike & { round?: number })[];
      return {
        segments: raw.map((r, i) => ({ ...r, qValue: q[i] })),
        homogeneity: mc((h) => eraHomogeneityStatistic(h), 'greater', seed + 5),
        recent: { draws: recentDraws.length, from: recentDraws[0].round ?? n - 99, pValue: frequencyUniformityTest(recentDraws).pValue },
      };
    })(),
  };
  return { ...result, summary: summarize(result) };
}

function summarize(a: Omit<Analysis, 'summary'>): SummaryRow[] {
  const rows: Omit<SummaryRow, 'qValue'>[] = [
    { key: 'freq', name: '번호 빈도 균등성', theory: '피어슨 카이제곱 (비복원 보정)', pValue: a.frequency.pValue },
    { key: 'perNumber', name: '개별 번호 편향', theory: '이항검정 + BH 보정', pValue: Math.min(...a.numbers.tests.map((t) => t.qValue)) },
    { key: 'pairs', name: '번호쌍 동반출현', theory: '카이제곱 + 몬테카를로', pValue: a.pairs.pValue },
    { key: 'sum', name: '합계 분포', theory: 'KS 검정 + 몬테카를로', pValue: a.sum.ksMonteCarlo.pValue },
    { key: 'oddEven', name: '홀짝 비율', theory: '초기하분포 적합도', pValue: a.oddEven.pValue },
    { key: 'lowHigh', name: '고저 비율', theory: '초기하분포 적합도', pValue: a.lowHigh.pValue },
    { key: 'range', name: '번호 범위', theory: '순서통계량 적합도', pValue: a.range.pValue },
    { key: 'consecutive', name: '연속번호 비율', theory: '조합론 + 정규근사', pValue: a.consecutive.pValue },
    { key: 'overlap', name: '이월수', theory: '초기하분포 적합도', pValue: a.overlap.pValue },
    { key: 'gaps', name: '재출현 간격', theory: '기하분포(무기억성) 적합도', pValue: a.gaps.pValue },
    { key: 'ljungBox', name: '합계 시계열 자기상관', theory: 'Ljung–Box + 몬테카를로', pValue: a.sum.ljungBoxMonteCarlo.pValue },
    { key: 'runs', name: '출현 수열 무작위성', theory: '런 검정 + BH 보정', pValue: Math.min(...a.runs.map((r) => r.qValue)) },
    { key: 'bonus', name: '보너스 번호 균등성', theory: '카이제곱 적합도', pValue: a.bonus.test.pValue },
    { key: 'eras', name: '시기별 안정성', theory: '분할표 동질성 + 몬테카를로', pValue: a.eras.homogeneity.pValue },
  ];
  const q = benjaminiHochberg(rows.map((r) => r.pValue));
  return rows.map((r, i) => ({ ...r, qValue: q[i] }));
}
