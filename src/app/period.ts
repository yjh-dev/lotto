/** 분석 기간(표본) 선택 */
import type { Draw } from '../data/types.ts';

export type PeriodKey = 'all' | 'r500' | 'r300' | 'r100' | 'r50' | 'custom';

/** 최근 N회 기준 (연 단위 대신 회차 수) */
export const PRESETS: { key: PeriodKey; label: string; rounds?: number }[] = [
  { key: 'all', label: '전체' },
  { key: 'r500', label: '500회', rounds: 500 },
  { key: 'r300', label: '300회', rounds: 300 },
  { key: 'r100', label: '100회', rounds: 100 },
  { key: 'r50', label: '50회', rounds: 50 },
  { key: 'custom', label: '직접' },
];

/** 시기별 분석이 5구간 × 10회 이상이 되도록 */
export const MIN_DRAWS = 50;

export interface PeriodSel {
  key: PeriodKey;
  from?: number;
  to?: number;
}

export interface ResolvedPeriod {
  key: PeriodKey;
  from: number;
  to: number;
  count: number;
  label: string;
}

export function resolvePeriod(sel: PeriodSel, draws: readonly Draw[]): ResolvedPeriod {
  const first = draws[0].round;
  const last = draws.at(-1)!.round;
  const preset = PRESETS.find((p) => p.key === sel.key) ?? PRESETS[0];
  let from = first;
  let to = last;
  if (preset.rounds) from = Math.max(first, last - preset.rounds + 1);
  if (sel.key === 'custom' && sel.from && sel.to) {
    to = Math.min(last, Math.max(sel.from, sel.to));
    from = Math.max(first, Math.min(sel.from, sel.to));
    if (to - from + 1 < MIN_DRAWS) from = Math.max(first, to - MIN_DRAWS + 1);
  }
  const fromDate = draws.find((d) => d.round === from)?.date ?? '';
  const toDate = draws.find((d) => d.round === to)?.date ?? '';
  return {
    key: sel.key,
    from,
    to,
    count: to - from + 1,
    label: `${preset.rounds ? `최근 ${to - from + 1}회 · ` : ''}${from}~${to}회 (${fromDate.slice(0, 7).replace('-', '.')}~${toDate.slice(0, 7).replace('-', '.')})`,
  };
}

const KEY = 'lotto.period.v1';

export function loadPeriodSel(): PeriodSel {
  try {
    const sel = JSON.parse(localStorage.getItem(KEY) ?? 'null') as PeriodSel | null;
    // 예전 연 단위 키(10y 등)는 전체로
    return sel && PRESETS.some((p) => p.key === sel.key) ? sel : { key: 'all' };
  } catch {
    return { key: 'all' };
  }
}

export function savePeriodSel(sel: PeriodSel) {
  try {
    localStorage.setItem(KEY, JSON.stringify(sel));
  } catch {
    /* 무시 */
  }
}
