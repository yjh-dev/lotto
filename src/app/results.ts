/** 워커 → 화면으로 전달되는 결과 (구조화 복제 가능한 순수 데이터) */
import type { Analysis } from '../stats/analysis.ts';
import type { StrategyResult } from '../stats/backtest.ts';
import type { RecommendResult } from '../recommend/recommend.ts';
import type { RuleAuditRow } from '../recommend/rules.ts';

export const RESULTS_VERSION = 10;

/** 선택한 기간의 통계·규칙 감시·추천 — 기간이 바뀌면 다시 계산 */
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
  /** 감시에서 경고된 규칙을 해제하고 만든 추천 (대상은 항상 다음 회차) */
  recommendation: RecommendResult;
}

export type WorkerRequest =
  | { id: number; type: 'period'; draws: unknown[]; from: number; to: number; iterations: number }
  | { id: number; type: 'recommend'; draws: unknown[]; seed: number; disabled: string[] };

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };
