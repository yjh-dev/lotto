/** 분석 기간(표본) 선택 */
import type { Draw } from '../data/types.ts';

export type PeriodKey = 'all' | '10y' | '5y' | '3y' | '1y' | 'custom';

export const PRESETS: { key: PeriodKey; label: string; weeks?: number }[] = [
  { key: 'all', label: '전체' },
  { key: '10y', label: '10년', weeks: 522 },
  { key: '5y', label: '5년', weeks: 261 },
  { key: '3y', label: '3년', weeks: 157 },
  { key: '1y', label: '1년', weeks: 52 },
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
  if (preset.weeks) from = Math.max(first, last - preset.weeks + 1);
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
    label: `${from}~${to}회 · ${fromDate.slice(0, 7).replace('-', '.')}~${toDate.slice(0, 7).replace('-', '.')}`,
  };
}

const KEY = 'lotto.period.v1';

export function loadPeriodSel(): PeriodSel {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? 'null') as PeriodSel | null) ?? { key: 'all' };
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
