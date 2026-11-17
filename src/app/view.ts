import type { Draw } from '../data/types.ts';
import type { HomeResults, PeriodResults } from './results.ts';
import type { ResolvedPeriod } from './period.ts';
import type { RecommendResult } from '../recommend/recommend.ts';
import type { StoredPurchase, StoredRecommendation } from '../db/repository.ts';
import type { AppRelease } from '../data/store.ts';

/** 맥북 서버에서 받아 오는 데이터 (undefined = 불러오는 중, null = 연결 안 됨) */
export interface ServerData {
  purchases: StoredPurchase[] | null | undefined;
  recs: StoredRecommendation[] | null | undefined;
  latestApp: AppRelease | null | undefined;
  /** 맥북에 아직 못 보낸 용지 수 */
  pending: number;
}

export interface AppSettings {
  native: boolean;
  notify: boolean;
  version: string | null;
  versionCode: number | null;
  /** 마지막 맥북 연결 결과 (null = 아직 시도 안 함) */
  online: boolean | null;
  lastSync: string | null;
}

export interface ViewCtx {
  draws: Draw[];
  /** 선택 기간 통계 (통계·검정 탭, 계산 중이면 null) */
  period: PeriodResults | null;
  range: ResolvedPeriod;
  /** 이번 주 추천 (기간 무관, 계산 중이면 null) */
  home: HomeResults | null;
  /** 화면에 보이는 추천 (선택한 방식 · "다른 조합" · 고정 번호 반영) */
  rec: RecommendResult | null;
  /** 홈에서 고른 추천 방식 */
  strategy: 'default' | 'hot';
  server: ServerData;
  settings: AppSettings;
  /** 같은 화면 다시 그리기 (탭 안의 하위 메뉴 전환 등) */
  rerender: () => void;
}

export interface View {
  key: string;
  label: string;
  icon: string;
  /** 기간 선택 막대 표시 여부 (탭 안 하위 메뉴에 따라 달라지면 함수) */
  usesPeriod: boolean | (() => boolean);
  /** 하단 메뉴에 표시 (설정은 오른쪽 위 톱니바퀴) */
  inNav?: boolean;
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
  buy: svg('<path d="M4 7h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z"/><path d="M10 7v12" stroke-dasharray="2 2"/>'),
  stats: svg('<path d="M3 20h18"/><path d="M6 16V9"/><path d="M10 16V5"/><path d="M14 16v-6"/><path d="M18 16v-9"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
};
