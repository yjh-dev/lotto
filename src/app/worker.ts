/// <reference lib="webworker" />
/** 백그라운드 계산 워커 — 몬테카를로·백테스트·규칙 감시·당첨 확률 전수 계산을 화면 스레드 밖에서 실행 */
import type { Draw } from '../data/types.ts';
import { runAnalysis } from '../stats/analysis.ts';
import { runBacktest } from '../stats/backtest.ts';
import { auditRules } from '../recommend/rules.ts';
import { recommend as baseRecommend, type RecommendOptions, type RecommendResult } from '../recommend/recommend.ts';
import { exactSetOdds } from '../recommend/odds.ts';
import { RESULTS_VERSION, type PeriodResults, type WorkerRequest, type WorkerResponse } from './results.ts';

/** 백테스트는 판매·당첨금 데이터가 안정된 262회부터 */
const BACKTEST_FROM = 262;

/** 추천 + 묶음 당첨 확률(모든 당첨번호 대입, 약 0.3초) */
function recommend(draws: Draw[], opts?: RecommendOptions): RecommendResult {
  const r = baseRecommend(draws, opts);
  return { ...r, setOdds: exactSetOdds(r.picks.map((p) => p.numbers)) };
}

function compute(req: WorkerRequest): unknown {
  const draws = req.draws as Draw[];
  if (req.type === 'period') {
    const sample = draws.filter((d) => d.round >= req.from && d.round <= req.to);
    const btFrom = Math.max(BACKTEST_FROM, req.from);
    const audit = auditRules(draws, req.from, req.to);
    return {
      version: RESULTS_VERSION,
      lastRound: draws.at(-1)!.round,
      from: req.from,
      to: req.to,
      iterations: req.iterations,
      analysis: runAnalysis(sample, { iterations: req.iterations }),
      // 각 회차 예측에는 그 이전 전체 이력을 쓰고, 평가는 선택 기간 안에서만
      backtest: btFrom <= req.to ? runBacktest(draws, undefined, { startRound: btFrom, endRound: req.to }) : null,
      audit,
      // 규칙 판정(과거 조합·최근 10회)은 항상 실제 최신 데이터 기준, 해제 여부만 선택 기간 감시 결과로
      recommendation: recommend(draws, { disabled: audit.filter((a) => a.warn).map((a) => a.key) }),
    } satisfies PeriodResults;
  }
  return recommend(draws, { seed: req.seed, disabled: req.disabled });
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  try {
    self.postMessage({ id: e.data.id, ok: true, result: compute(e.data) } satisfies WorkerResponse);
  } catch (err) {
    self.postMessage({ id: e.data.id, ok: false, error: (err as Error).message } satisfies WorkerResponse);
  }
};
