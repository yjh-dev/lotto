/** 워커 → 화면으로 전달되는 결과 (구조화 복제 가능한 순수 데이터) */
import type { Analysis } from '../stats/analysis.ts';
import type { StrategyResult } from '../stats/backtest.ts';
import type { RecommendResult } from '../recommend/recommend.ts';
import type { RuleAuditRow } from '../recommend/rules.ts';

export const RESULTS_VERSION = 14;

/**
 * 홈: 이번 주 추천 — 기간과 무관. 규칙 판정(과거 조합·최근 10회)과 규칙 감시는 전체 회차 기준
 * (모든 조합의 확률이 같으므로 표본 기간이 추천 번호를 바꿀 근거가 없음)
 */
export interface HomeResults {
  version: number;
  lastRound: number;
  /** 전체 회차 규칙 감시 → 경고된 규칙은 추천에서 해제 */
  disabled: string[];
  /** 기본 방식 (비인기 우선) */
  recommendation: RecommendResult;
  /** 핫 번호 방식 (최근 50회 상위 번호를 게임마다 2개) */
  hotRecommendation: RecommendResult;
}

/** 선택한 기간의 통계·규칙 감시 — 기간이 바뀌면 다시 계산 */
export interface PeriodResults {
  version: number;
  lastRound: number;
  from: number;
  to: number;
  iterations: number;
  analysis: Analysis;
  /** 262회 이전만 고른 기간이면 null (판매 데이터 없음) */
  backtest: StrategyResult[] | null;
  /** 이 기간 당첨번호로 우리 규칙을 감시한 결과 */
  audit: RuleAuditRow[];
}

export type WorkerRequest =
  | { id: number; type: 'period'; draws: unknown[]; from: number; to: number; iterations: number }
  | { id: number; type: 'home'; draws: unknown[] }
  | { id: number; type: 'recommend'; draws: unknown[]; seed: number; disabled: string[]; fixed: number[]; strategy: 'default' | 'hot' };

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };
