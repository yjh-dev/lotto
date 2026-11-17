/** 워커 호출 + 결과 캐시 (최신 회차·기간이 같으면 다시 계산하지 않음) */
import type { Draw } from '../data/types.ts';
import type { RecommendResult } from '../recommend/recommend.ts';
import { RESULTS_VERSION, type HomeResults, type PeriodResults, type WorkerRequest, type WorkerResponse } from './results.ts';

const PERIOD_KEY = `lotto.periods.v${RESULTS_VERSION}`;
const HOME_KEY = `lotto.home.v${RESULTS_VERSION}`;
/** 기간별 결과는 최근 사용한 것부터 이만큼만 보관 */
const PERIOD_CACHE_SIZE = 6;
export const DEFAULT_ITERATIONS = 1000;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.result);
    else p.reject(new Error(e.data.error));
  };
  return worker;
}

type Req = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

function call<T>(req: Req): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    getWorker().postMessage({ ...req, id });
  });
}

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}

function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* 용량 초과 등 — 캐시 없이 동작 */
  }
}

// ───────── 홈 (이번 주 추천) ─────────

export function cachedHome(lastRound: number): HomeResults | null {
  const r = read<HomeResults>(HOME_KEY);
  return r?.lastRound === lastRound ? r : null;
}

export async function computeHome(draws: Draw[]): Promise<HomeResults> {
  const r = await call<HomeResults>({ type: 'home', draws });
  write(HOME_KEY, r);
  return r;
}

// ───────── 기간별 통계 ─────────

export function cachedPeriod(lastRound: number, from: number, to: number): PeriodResults | null {
  return read<PeriodResults[]>(PERIOD_KEY)?.find((r) => r.lastRound === lastRound && r.from === from && r.to === to) ?? null;
}

export async function computePeriod(draws: Draw[], from: number, to: number, iterations = DEFAULT_ITERATIONS): Promise<PeriodResults> {
  const r = await call<PeriodResults>({ type: 'period', draws, from, to, iterations });
  const others = (read<PeriodResults[]>(PERIOD_KEY) ?? []).filter((x) => x.lastRound === r.lastRound && !(x.from === from && x.to === to));
  write(PERIOD_KEY, [r, ...others].slice(0, PERIOD_CACHE_SIZE));
  return r;
}

/** 같은 규칙(해제 목록 포함)으로 다른 시드에서 다시 추천 */
export function reRecommend(draws: Draw[], seed: number, disabled: string[], fixed: number[] = [], strategy: 'default' | 'hot' = 'default'): Promise<RecommendResult> {
  return call<RecommendResult>({ type: 'recommend', draws, seed, disabled, fixed, strategy });
}
