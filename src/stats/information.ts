/** 정보이론 — 섀넌 엔트로피, KL 발산 */
import { lnChoose } from './math.ts';
import { K, N } from './probability.ts';
import { numberCounts, type DrawLike } from './descriptive.ts';

/** 조합 하나의 최대 엔트로피 log₂ C(45,6) ≈ 22.96 bits — 완전 무작위일 때 한 회차가 담는 정보량 */
export const COMBO_ENTROPY_BITS = lnChoose(N, K) / Math.LN2;
/** 번호 분포의 최대 엔트로피 log₂ 45 ≈ 5.49 bits */
export const MAX_NUMBER_ENTROPY_BITS = Math.log2(N);

export interface EntropyResult {
  /** 관측 번호 분포의 엔트로피 (bits) */
  entropy: number;
  maxEntropy: number;
  /** entropy / maxEntropy (1이면 완전 균등) */
  efficiency: number;
  /** KL(관측 ‖ 균등) bits — 0이면 완전 균등 */
  klToUniform: number;
}

export function numberEntropy(draws: readonly DrawLike[]): EntropyResult {
  const counts = numberCounts(draws).slice(1);
  const total = counts.reduce((a, b) => a + b, 0);
  let h = 0;
  for (const c of counts) {
    if (c === 0) continue;
    const q = c / total;
    h -= q * Math.log2(q);
  }
  return {
    entropy: h,
    maxEntropy: MAX_NUMBER_ENTROPY_BITS,
    efficiency: h / MAX_NUMBER_ENTROPY_BITS,
    // 균등분포 기준: KL(q‖u) = log₂N − H(q)
    klToUniform: MAX_NUMBER_ENTROPY_BITS - h,
  };
}
