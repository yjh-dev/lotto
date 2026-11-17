/**
 * 우리 추천 규칙 — 과거 당첨번호가 드물게 보인 "모양"을 제외
 *
 * 중요: 공정한 추첨에서는 모든 조합의 당첨 확률이 같다. 규칙은 확률을 올리지도 내리지도 않는다.
 * "홀수 6개"가 드문 것은 그런 조합이 원래 적기 때문(전체의 2.2%)이지 하나하나가 덜 뽑혀서가 아니다.
 * 그래서 규칙 감시(auditRules)로 "제외 유형이 실제 당첨에서 이론 비율보다 많이 나오는지"를 계속 확인하고,
 * 유의하게 많으면(BH 보정 q < 0.05) 그 규칙을 추천에서 자동 해제한다.
 *
 * 사전 등록: 규칙과 기준값은 결과를 보고 바꾸지 않는다. 바꾸면 RULES_REVISION과 아래 이력에 기록.
 *   rev 1 (2026-11-17) 최초 9개
 */
import { mulberry32, regBeta, type Rng } from '../stats/math.ts';
import { simulateDraw } from '../stats/simulate.ts';
import { benjaminiHochberg } from '../stats/hypothesis.ts';
import { TOTAL_COMBOS } from '../stats/probability.ts';

export const RULES_REVISION = 1;
/** 규칙을 모두 적용해도 후보가 이 비율 이상 남아야 함 */
export const MIN_ELIGIBLE_SHARE = 0.5;
export const RECENT_WINDOW = 10;

/** 규칙 판정에 필요한 과거 정보 (대상 회차 직전까지) */
export interface RuleContext {
  /** 과거 당첨 조합 키 (정렬된 번호를 '-'로 연결) */
  past: ReadonlySet<string>;
  /** 최근 RECENT_WINDOW회 당첨번호 */
  recent: readonly (readonly number[])[];
}

export interface Rule {
  key: string;
  name: string;
  /** true = 제외. s는 오름차순 6개 */
  test: (s: readonly number[], ctx: RuleContext) => boolean;
}

export const comboKey = (s: readonly number[]) => s.join('-');
const overlap = (a: readonly number[], b: readonly number[]) => a.filter((n) => b.includes(n)).length;
const maxRun = (s: readonly number[]) => {
  let best = 1;
  let run = 1;
  for (let i = 1; i < s.length; i++) {
    run = s[i] === s[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
};
/** AC값 = 서로 다른 차이의 개수 − 5 (0~10, 클수록 간격이 다양) */
export const acValue = (s: readonly number[]) => {
  const d = new Set<number>();
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) d.add(s[j] - s[i]);
  return d.size - (s.length - 1);
};

export const RULES: Rule[] = [
  { key: 'past', name: '과거 당첨 조합과 동일', test: (s, c) => c.past.has(comboKey(s)) },
  { key: 'recent', name: `최근 ${RECENT_WINDOW}회 당첨번호와 4개 이상 일치`, test: (s, c) => c.recent.some((r) => overlap(s, r) >= 4) },
  { key: 'sum', name: '합계 81 미만 · 195 초과', test: (s) => { const t = s.reduce((a, b) => a + b, 0); return t < 81 || t > 195; } },
  { key: 'oddEven', name: '홀짝 6:0', test: (s) => { const o = s.filter((n) => n % 2).length; return o === 0 || o === 6; } },
  { key: 'lowHigh', name: '고저 6:0 (1~22 / 23~45)', test: (s) => { const l = s.filter((n) => n <= 22).length; return l === 0 || l === 6; } },
  {
    key: 'decade', name: '한 번호대에 4개 이상', test: (s) => {
      const c = [0, 0, 0, 0, 0];
      for (const n of s) c[Math.min(4, Math.floor((n - 1) / 10))]++;
      return Math.max(...c) >= 4;
    },
  },
  { key: 'ac', name: 'AC값 6 이하', test: (s) => acValue(s) <= 6 },
  { key: 'run3', name: '연속번호 3개 이상', test: (s) => maxRun(s) >= 3 },
  { key: 'arith', name: '등차수열', test: (s) => s.every((n, i) => i < 2 || n - s[i - 1] === s[1] - s[0]) },
];

/** draws[0..end) 를 과거로 하는 판정 정보 */
export function ruleContext(draws: readonly { numbers: readonly number[] }[], end = draws.length): RuleContext {
  const past = new Set<string>();
  for (let i = 0; i < end; i++) past.add(comboKey([...draws[i].numbers].sort((a, b) => a - b)));
  return { past, recent: draws.slice(Math.max(0, end - RECENT_WINDOW), end).map((d) => d.numbers) };
}

/** 걸리는 규칙 키 (disabled는 건너뜀) */
export function ruleFlags(s: readonly number[], ctx: RuleContext, disabled: readonly string[] = []): string[] {
  const sorted = [...s].sort((a, b) => a - b);
  return RULES.filter((r) => !disabled.includes(r.key) && r.test(sorted, ctx)).map((r) => r.key);
}

/** 무작위 조합 중 규칙을 모두 통과하는 비율 */
export function eligibleShare(ctx: RuleContext, disabled: readonly string[] = [], samples = 20_000, rng: Rng = mulberry32(17)): number {
  let ok = 0;
  for (let i = 0; i < samples; i++) if (ruleFlags(simulateDraw(rng).numbers, ctx, disabled).length === 0) ok++;
  return ok / samples;
}

// ───────── 규칙 감시 ─────────

export interface RuleAuditRow {
  key: string;
  name: string;
  /** 감시한 회차 수 */
  draws: number;
  /** 실제 당첨번호가 이 유형이었던 횟수 */
  observed: number;
  /** 무작위 조합 중 이 유형 비율 (같은 과거 기준 몬테카를로) */
  expectedRate: number;
  /** 단측 p: 이론보다 많이 나왔는가 */
  pValue: number;
  qValue: number;
  /** q < 0.05 → 규칙이 데이터와 맞지 않음 → 추천에서 해제 */
  warn: boolean;
}

/** P(X ≥ k), X ~ Binomial(n, p) */
function binomUpper(k: number, n: number, p: number): number {
  if (k <= 0) return 1;
  if (p <= 0) return 0;
  return regBeta(p, k, n - k + 1);
}

/**
 * 회차 [from, to]의 실제 당첨번호를 규칙별로 판정해 이론 비율과 비교.
 * 이론 비율은 각 회차마다 그 직전까지의 과거로 무작위 조합을 판정해 추정 (총 약 5만 조합).
 */
export function auditRules(draws: readonly { round: number; numbers: readonly number[] }[], from = 1, to = Infinity): RuleAuditRow[] {
  const idx = draws.map((d, i) => (d.round >= from && d.round <= to && i >= RECENT_WINDOW ? i : -1)).filter((i) => i >= 0);
  const n = idx.length;
  const perDraw = n ? Math.max(20, Math.ceil(50_000 / n)) : 0;
  const obs = new Array(RULES.length).fill(0);
  const hit = new Array(RULES.length).fill(0);
  const rng = mulberry32(29);
  const past = new Set<string>();
  let filled = 0;
  /** '과거 당첨 조합과 동일'은 무작위로 거의 안 나와 몬테카를로로 못 잡음 → 정확값 Σ 과거 조합 수 / C(45,6) */
  let pastExact = 0;
  const PAST = RULES.findIndex((r) => r.key === 'past');
  for (const i of idx) {
    while (filled < i) past.add(comboKey([...draws[filled++].numbers].sort((a, b) => a - b)));
    const ctx: RuleContext = { past, recent: draws.slice(i - RECENT_WINDOW, i).map((d) => d.numbers) };
    pastExact += past.size / TOTAL_COMBOS;
    const win = [...draws[i].numbers].sort((a, b) => a - b);
    RULES.forEach((r, k) => { if (r.test(win, ctx)) obs[k]++; });
    for (let t = 0; t < perDraw; t++) {
      const s = simulateDraw(rng).numbers;
      RULES.forEach((r, k) => { if (r.test(s, ctx)) hit[k]++; });
    }
  }
  const rows = RULES.map((r, k) => {
    const rate = !n ? 0 : k === PAST ? pastExact / n : hit[k] / (n * perDraw);
    return { key: r.key, name: r.name, draws: n, observed: obs[k], expectedRate: rate, pValue: binomUpper(obs[k], n, rate), qValue: 1, warn: false };
  });
  const q = benjaminiHochberg(rows.map((r) => r.pValue));
  rows.forEach((r, k) => {
    r.qValue = q[k];
    r.warn = n > 0 && q[k] < 0.05;
  });
  return rows;
}
