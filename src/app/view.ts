import type { Draw } from '../data/types.ts';
import type { PeriodResults } from './results.ts';
import type { ResolvedPeriod } from './period.ts';
import type { HomeState } from './views-home.ts';

export interface ViewCtx {
  draws: Draw[];
  /** 선택 기간 통계 (계산 중이면 null) */
  period: PeriodResults | null;
  range: ResolvedPeriod;
  /** 홈 화면 상태 ("다른 조합" 포함 추천) */
  home?: HomeState;
}

export interface View {
  key: string;
  label: string;
  icon: string;
  /** 기간 선택 막대 표시 여부 */
  usesPeriod: boolean;
  render(c: ViewCtx): string;
  after?(c: ViewCtx): void;
}

const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICONS = {
  home: svg('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>'),
  numbers: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  patterns: svg('<path d="M3 20h18"/><path d="M6 16V9"/><path d="M10 16V5"/><path d="M14 16v-6"/><path d="M18 16v-9"/>'),
  tests: svg('<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>'),
  refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>'),
};
