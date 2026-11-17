/**
 * 금주 추천 — 목표: 3·4등을 포함해 "당첨 자체"
 *
 * 한 게임의 당첨 확률은 어떤 조합이든 같다(1등 1/8,145,060). 바꿀 수 있는 건 5게임을 묶는 방식뿐.
 *
 *  기본 매주 10게임 (DEFAULT_GAMES). 45개 번호로 서로소 6개 묶음은 7게임(42개)까지라:
 *   · 7게임 이하: 번호가 하나도 겹치지 않게
 *   · 8게임 이상: 어느 두 게임도 겹치는 번호 1개 이하(같은 번호쌍이 두 게임에 없음) → 4등 이상은 여전히 서로 배타라
 *     "하나라도 4등 이상" = 게임 수 × 11,350/C(45,6) (10게임 1.39%, 이론 최대). 덜 쓴 번호부터 채워 고르게 분산
 *  1. 묶음 구성(7게임 이하 기준): 5게임 30개 번호가 서로 하나도 겹치지 않게
 *     · 겹침 ≤ 1이면 두 게임이 동시에 4개 이상 맞을 수 없다 (4+4−1 > 6)
 *       → "하나라도 4등 이상" = 5 × 11,350/C(45,6) = 0.697% (이론 최대), 3등 이상도 최대
 *     · 겹침 0이면 3개 일치(5등)끼리도 덜 겹쳐 "하나라도 당첨" 11.87% (이론 최대 11.92%)
 *     · 서로소 묶음은 번호 이름만 바꾸면 서로 같아지므로(대칭) 어떤 서로소 묶음이든 확률이 같다
 *  2. 우리 규칙(rules.ts)에 걸리는 조합 제외 — 확률에는 영향 없음, 감시에서 경고된 규칙은 해제
 *  고정 번호(최대 게임 수만큼): 게임마다 하나씩 넣음 → 30개 번호 서로 다름이 유지돼 확률이 그대로
 *  3. 나머지는 무작위 (조합마다 확률이 같으므로 특정 번호를 편애할 근거가 없음)
 *     동점 처리(popularity가 있을 때): 조건(겹침·규칙)을 만족해 확률이 같은 후보 여럿 중 구매자가 덜 고르는 조합
 *     → 확률은 그대로, 당첨 시 나눌 사람이 적을 것으로 추정 (popularity.ts)
 *     시드 = 대상 회차 → 같은 데이터면 맥북 서버와 휴대폰이 같은 추천
 */
import { mulberry32, type Rng } from '../stats/math.ts';
import { ruleContext, ruleFlags, eligibleShare } from './rules.ts';
import type { SetOdds } from './odds.ts';
import { comboMultiplier, comboScore, type NumberPopularity } from './popularity.ts';

/** 동점 처리: 게임마다 조건을 만족하는 후보를 이만큼 만들고 가장 덜 고르는 조합을 고름 */
const TIE_CANDIDATES = 60;

/** 매주 추천 게임 수 */
export const DEFAULT_GAMES = 10;

export interface Pick {
  numbers: number[];
}

export interface RecommendResult {
  targetRound: number;
  seed: number;
  picks: Pick[];
  /** 추천에서 해제된 규칙 (감시 경고) */
  disabled: string[];
  /** 무작위 조합 중 규칙을 모두 통과하는 비율 */
  eligibleShare: number;
  /** 고정 번호 (없으면 빈 배열) */
  fixed: number[];
  strategy: Strategy;
  /** 핫 번호 방식일 때 쓴 핫 번호 */
  hot: number[];
  /** 동점 처리에 쓴 인기도: 게임별 배수와 평균 (1보다 작으면 덜 고르는 조합) */
  popularity?: { multipliers: number[]; average: number };
  /** 추천 묶음의 정확한 당첨 확률 (앱 워커에서 계산해 붙임 — odds.ts) */
  setOdds?: SetOdds;
}

export interface RecommendOptions {
  games?: number;
  seed?: number;
  /** 해제할 규칙 키 */
  disabled?: readonly string[];
  /** 고정 번호 — i번째 번호는 i번째 게임에 들어감 */
  fixed?: readonly number[];
  /** 있으면 동점일 때 비인기 조합 우선 */
  popularity?: NumberPopularity;
  /** 'hot': 최근 자주 나온 번호를 게임마다 2개씩 (hotNumbers로 구한 목록) */
  strategy?: Strategy;
}

export type Strategy = 'default' | 'hot';
/** 핫 번호 = 최근 HOT_WINDOW회 출현 횟수 상위 (게임 수만큼) */
export const HOT_WINDOW = 50;

/** 최근 window회 출현 횟수 상위 k개 (같으면 작은 번호 먼저) */
export function hotNumbers(draws: readonly { numbers: readonly number[] }[], k: number, window = HOT_WINDOW): number[] {
  const c = new Array(46).fill(0);
  for (const d of draws.slice(-window)) for (const n of d.numbers) c[n]++;
  return Array.from({ length: 45 }, (_, i) => i + 1)
    .sort((a, b) => c[b] - c[a] || a - b)
    .slice(0, k);
}

/** pool에서 6개 무작위 (부분 Fisher–Yates), 오름차순 */
function sample6(pool: number[], rng: Rng): number[] {
  const a = [...pool];
  for (let i = 0; i < 6; i++) {
    const j = i + Math.floor(rng() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, 6).sort((x, y) => x - y);
}

export function recommend(draws: readonly { round: number; numbers: readonly number[] }[], opts: RecommendOptions = {}): RecommendResult {
  const games = opts.games ?? DEFAULT_GAMES;
  if (!Number.isInteger(games) || games < 1 || games > 30) throw new Error('게임 수는 1~30');
  const targetRound = draws.at(-1)!.round + 1;
  const seed = opts.seed ?? targetRound;
  const disabled = [...(opts.disabled ?? [])];
  const fixed = [...new Set(opts.fixed ?? [])];
  if (fixed.length > games || fixed.some((n) => !Number.isInteger(n) || n < 1 || n > 45)) throw new Error(`고정 번호는 1~45 중 최대 ${games}개`);
  const rng = mulberry32(seed);
  const ctx = ruleContext(draws);

  const strategy = opts.strategy ?? 'default';
  if (strategy === 'hot' && (fixed.length || games < 3)) throw new Error('핫 번호 방식은 고정 번호 없이 3게임 이상');
  const hot = strategy === 'hot' ? hotNumbers(draws, games) : [];
  const pop = opts.popularity;
  const score = pop ? (s: readonly number[]) => comboScore(pop, s) : null;
  const done = (picks: Pick[]): RecommendResult => {
    const res: RecommendResult = { targetRound, seed, picks, disabled, fixed, strategy, hot, eligibleShare: eligibleShare(ctx, disabled) };
    if (pop) {
      const multipliers = picks.map((p) => comboMultiplier(pop, p.numbers));
      res.popularity = { multipliers, average: multipliers.reduce((a, b) => a + b, 0) / multipliers.length };
    }
    return res;
  };

  const ok = (s: number[]) => ruleFlags(s, ctx, disabled).length === 0;
  if (strategy === 'hot') {
    // 핫 번호를 무작위 순서로 원형으로 이어 짝(이웃끼리) → 게임마다 서로 다른 짝 2개, 핫 번호마다 정확히 2게임
    const starts = () => {
      const h = [...hot];
      for (let i = h.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [h[i], h[j]] = [h[j], h[i]];
      }
      return h.map((x, i) => [x, h[(i + 1) % h.length]]);
    };
    return done(packPairs(games, starts, hot, rng, ok, score));
  }
  if (games * 6 > 45) return done(packPairs(games, () => Array.from({ length: games }, (_, i) => (fixed[i] === undefined ? [] : [fixed[i]])), fixed, rng, ok, score));

  // 남은 번호에서 규칙을 통과하는 6개를 차례로 뽑음. 막히면(드묾) 처음부터 다시
  for (let attempt = 0; attempt < 100; attempt++) {
    // 고정 번호는 다른 게임에 들어가지 않도록 미리 빼 둠
    const unused = new Set(Array.from({ length: 45 }, (_, i) => i + 1).filter((n) => !fixed.includes(n)));
    const picks: Pick[] = [];
    while (picks.length < games) {
      const f = fixed[picks.length];
      let found: number[] | null = null;
      let best = Infinity;
      let ok = 0;
      for (let t = 0; t < 4000 && ok < (score ? TIE_CANDIDATES : 1); t++) {
        const s = f === undefined ? sample6([...unused], rng) : [f, ...sample6([...unused], rng).slice(0, 5)].sort((a, b) => a - b);
        if (ruleFlags(s, ctx, disabled).length !== 0) continue;
        ok++;
        const v = score ? score(s) : 0;
        if (!found || v < best) {
          found = s;
          best = v;
        }
      }
      if (!found) break;
      found.forEach((n) => unused.delete(n));
      picks.push({ numbers: found });
    }
    if (picks.length === games) return done(picks);
  }
  throw new Error('규칙을 만족하는 묶음을 찾지 못함');
}

/**
 * 같은 번호쌍이 두 게임에 들어가지 않게(= 게임끼리 겹침 ≤ 1) 한 게임씩 채움 (8게임 이상 · 핫 번호 방식).
 * 덜 쓴 번호를 먼저 시도 → 고르게 분산.
 * starts(): 게임별로 미리 넣을 번호 (고정 번호 1개, 핫 번호 짝 2개 등) — 시도마다 새로 받음
 * reserved: 미리 넣은 번호 — 채우는 단계에서는 쓰지 않음
 */
function packPairs(
  games: number,
  starts: () => number[][],
  reserved: readonly number[],
  rng: Rng,
  ok: (s: number[]) => boolean,
  score: ((s: readonly number[]) => number) | null,
): Pick[] {
  const pairKey = (a: number, b: number) => (a < b ? a * 64 + b : b * 64 + a);
  for (let attempt = 0; attempt < 200; attempt++) {
    const used = new Set<number>();
    const usage = new Array(46).fill(0);
    const picks: Pick[] = [];
    const init = starts();
    while (picks.length < games) {
      const head = init[picks.length] ?? [];
      const pool = Array.from({ length: 45 }, (_, i) => i + 1).filter((n) => !reserved.includes(n));
      let found: number[] | null = null;
      let best = Infinity;
      let valid = 0;
      for (let t = 0; t < 600 && valid < (score ? TIE_CANDIDATES : 1); t++) {
        // 무작위로 섞은 뒤 덜 쓴 번호 순 (같은 횟수끼리는 섞인 순서 유지)
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const order = pool.map((n, i) => ({ n, i })).sort((a, b) => usage[a.n] - usage[b.n] || a.i - b.i).map((x) => x.n);
        const set = [...head];
        for (const n of order) {
          if (set.length === 6) break;
          if (set.every((m) => !used.has(pairKey(m, n)))) set.push(n);
        }
        if (set.length === 6) {
          set.sort((a, b) => a - b);
          if (ok(set)) {
            valid++;
            const v = score ? score(set) : 0;
            if (!found || v < best) {
              found = set;
              best = v;
            }
          }
        }
      }
      if (!found) break;
      for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) used.add(pairKey(found[i], found[j]));
      found.forEach((n) => usage[n]++);
      picks.push({ numbers: found });
    }
    if (picks.length === games) return picks;
  }
  throw new Error('규칙을 만족하는 묶음을 찾지 못함');
}
