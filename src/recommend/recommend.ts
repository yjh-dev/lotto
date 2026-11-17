/**
 * 금주 추천 — 목표: 3·4등을 포함해 "당첨 자체"
 *
 * 한 게임의 당첨 확률은 어떤 조합이든 같다(1등 1/8,145,060). 바꿀 수 있는 건 5게임을 묶는 방식뿐.
 *
 *  1. 묶음 구성: 5게임 30개 번호가 서로 하나도 겹치지 않게
 *     · 겹침 ≤ 1이면 두 게임이 동시에 4개 이상 맞을 수 없다 (4+4−1 > 6)
 *       → "하나라도 4등 이상" = 5 × 11,350/C(45,6) = 0.697% (이론 최대), 3등 이상도 최대
 *     · 겹침 0이면 3개 일치(5등)끼리도 덜 겹쳐 "하나라도 당첨" 11.87% (이론 최대 11.92%)
 *     · 서로소 묶음은 번호 이름만 바꾸면 서로 같아지므로(대칭) 어떤 서로소 묶음이든 확률이 같다
 *  2. 우리 규칙(rules.ts)에 걸리는 조합 제외 — 확률에는 영향 없음, 감시에서 경고된 규칙은 해제
 *  3. 나머지는 무작위 (조합마다 확률이 같으므로 특정 번호를 편애할 근거가 없음)
 *     시드 = 대상 회차 → 같은 데이터면 맥북 서버와 휴대폰이 같은 추천
 */
import { mulberry32, type Rng } from '../stats/math.ts';
import { ruleContext, ruleFlags, eligibleShare } from './rules.ts';
import type { SetOdds } from './odds.ts';

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
  /** 추천 묶음의 정확한 당첨 확률 (앱 워커에서 계산해 붙임 — odds.ts) */
  setOdds?: SetOdds;
}

export interface RecommendOptions {
  games?: number;
  seed?: number;
  /** 해제할 규칙 키 */
  disabled?: readonly string[];
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
  const games = opts.games ?? 5;
  if (games * 6 > 45) throw new Error('서로 겹치지 않는 묶음은 7게임까지');
  const targetRound = draws.at(-1)!.round + 1;
  const seed = opts.seed ?? targetRound;
  const disabled = [...(opts.disabled ?? [])];
  const rng = mulberry32(seed);
  const ctx = ruleContext(draws);

  // 남은 번호에서 규칙을 통과하는 6개를 차례로 뽑음. 막히면(드묾) 처음부터 다시
  for (let attempt = 0; attempt < 100; attempt++) {
    const unused = new Set(Array.from({ length: 45 }, (_, i) => i + 1));
    const picks: Pick[] = [];
    while (picks.length < games) {
      let found: number[] | null = null;
      for (let t = 0; t < 2000 && !found; t++) {
        const s = sample6([...unused], rng);
        if (ruleFlags(s, ctx, disabled).length === 0) found = s;
      }
      if (!found) break;
      found.forEach((n) => unused.delete(n));
      picks.push({ numbers: found });
    }
    if (picks.length === games) return { targetRound, seed, picks, disabled, eligibleShare: eligibleShare(ctx, disabled) };
  }
  throw new Error('규칙을 만족하는 묶음을 찾지 못함');
}
