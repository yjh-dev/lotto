/**
 * 추천 조합의 당첨 확률
 *
 * ① 게임 하나: 어떤 조합이든 동일 — 초기하분포
 *     P(1등) = 1/C(45,6) = 1/8,145,060
 * ② 여러 게임 묶음: 게임끼리 번호가 겹치므로 단순 곱셈이 틀림 → 가능한 당첨번호 C(45,6)개를 전부 대입해 정확히 셈
 *     (1등은 서로 다른 조합끼리 동시에 일어날 수 없으므로 k게임이면 정확히 k/C(45,6))
 * ③ 베이지안 참고값: 디리클레 사후평균 θ를 "믿는다면" 이 조합이 균등 대비 몇 배인가
 *     비율 ≈ Π_{i∈c} 45θᵢ / E_균등[Π 45θⱼ]  (가중 추첨 근사)
 *     → 베이즈 인자가 균등 모형을 지지하므로 최선 추정은 ①이고, ③은 "과거 빈도를 믿으면"의 참고치
 */
import { mulberry32 } from '../stats/math.ts';
import { prizeOdds, TOTAL_COMBOS } from '../stats/probability.ts';
import { simulateDraw } from '../stats/simulate.ts';

export interface SetOdds {
  games: number;
  /** 하나 이상 당첨 확률 (1~5등 = 3개 이상 일치) */
  anyPrize: number;
  /** 하나 이상 4개 이상 일치 (4등 이상) */
  atLeast4: number;
  /** 하나 이상 5개 이상 일치 (2·3등 이상) */
  atLeast5: number;
  /** 하나 이상 1등 */
  first: number;
}

function popcount32(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** 번호 1~45를 두 개의 32비트 마스크로 (1~31 → lo, 32~45 → hi) */
function mask(nums: readonly number[]): [number, number] {
  let lo = 0;
  let hi = 0;
  for (const n of nums) {
    if (n <= 31) lo |= 1 << (n - 1);
    else hi |= 1 << (n - 32);
  }
  return [lo >>> 0, hi >>> 0];
}

/** 가능한 모든 당첨번호(8,145,060개)를 대입해 묶음 당첨 확률을 정확히 계산 */
export function exactSetOdds(games: readonly (readonly number[])[]): SetOdds {
  const ms = games.map(mask);
  const k = ms.length;
  let any = 0;
  let a4 = 0;
  let a5 = 0;
  let a6 = 0;
  const bit = (n: number): [number, number] => (n <= 31 ? [1 << (n - 1), 0] : [0, 1 << (n - 32)]);
  for (let a = 1; a <= 40; a++) {
    const [la, ha] = bit(a);
    for (let b = a + 1; b <= 41; b++) {
      const [lb, hb] = bit(b);
      for (let c = b + 1; c <= 42; c++) {
        const [lc, hc] = bit(c);
        for (let d = c + 1; d <= 43; d++) {
          const [ld, hd] = bit(d);
          const lo4 = la | lb | lc | ld;
          const hi4 = ha | hb | hc | hd;
          for (let e = d + 1; e <= 44; e++) {
            const [le, he] = bit(e);
            const lo5 = lo4 | le;
            const hi5 = hi4 | he;
            for (let f = e + 1; f <= 45; f++) {
              const lo = f <= 31 ? lo5 | (1 << (f - 1)) : lo5;
              const hi = f <= 31 ? hi5 : hi5 | (1 << (f - 32));
              let best = 0;
              for (let g = 0; g < k; g++) {
                const m = popcount32(lo & ms[g][0]) + popcount32(hi & ms[g][1]);
                if (m > best) best = m;
              }
              if (best >= 3) {
                any++;
                if (best >= 4) a4++;
                if (best >= 5) a5++;
                if (best === 6) a6++;
              }
            }
          }
        }
      }
    }
  }
  return { games: k, anyPrize: any / TOTAL_COMBOS, atLeast4: a4 / TOTAL_COMBOS, atLeast5: a5 / TOTAL_COMBOS, first: a6 / TOTAL_COMBOS };
}

/** 게임 하나의 등수별 확률 (모든 조합 동일) */
export const perGameOdds = () => prizeOdds();

/** 매주 g게임씩 y년 샀을 때 1등을 한 번 이상 할 확률 (회차 독립) */
export function firstPrizeOverYears(gamesPerWeek: number, years: number): number {
  const weeks = Math.round(52.18 * years);
  return 1 - (1 - gamesPerWeek / TOTAL_COMBOS) ** weeks;
}

/**
 * 베이지안 참고값: 사후평균 θ(index 1~45)를 믿을 때 조합의 1등 확률이 균등 대비 몇 배인지.
 * 가중 비복원추출의 근사로 Π 45θᵢ를 쓰고, 균등 무작위 조합 평균이 1이 되게 정규화.
 */
export function bayesRatio(theta: readonly number[], numbers: readonly number[], samples = 20_000): number {
  const score = (nums: readonly number[]) => nums.reduce((a, n) => a * 45 * theta[n], 1);
  const rng = mulberry32(6);
  let s = 0;
  for (let i = 0; i < samples; i++) s += score(simulateDraw(rng).numbers);
  return score(numbers) / (s / samples);
}
