/**
 * "필요할 때만" 요청 정책 — 맥북 수집기(→동행복권)와 휴대폰 앱(→맥북 서버)이 공통으로 사용
 *
 *  1. 날짜로 계산한 최신 회차가 이미 있으면 요청하지 않는다 (= 주 1회, 토요일 추첨 후에만)
 *  2. 요청했는데 새 회차를 못 받았으면(실패·미반영) 간격을 늘려 재시도: 1시간 → 이후 6시간
 *  3. 사용자가 직접 누른 확인(force)은 정책을 무시
 */
import { expectedLatestRound } from './normalize.ts';

export interface Attempt {
  /** ISO 시각 */
  at: string;
  /** 그때 기대한 최신 회차 */
  target: number;
  /** 새 회차를 1개 이상 받았는가 */
  gotNew: boolean;
}

export interface FetchDecision {
  fetch: boolean;
  target: number;
  reason: 'up-to-date' | 'due' | 'backoff' | 'forced';
  /** backoff일 때 다음 시도 가능 시각 */
  retryAt?: string;
}

const HOUR = 3_600_000;

export function backoffMs(consecutiveMisses: number): number {
  if (consecutiveMisses <= 0) return 0;
  return consecutiveMisses === 1 ? HOUR : 6 * HOUR;
}

/** @param attempts 최근 시도 (순서 무관) */
export function decideFetch(now: Date, lastRound: number, attempts: readonly Attempt[], force = false): FetchDecision {
  const target = expectedLatestRound(now);
  if (force) return { fetch: true, target, reason: 'forced' };
  if (target <= lastRound) return { fetch: false, target, reason: 'up-to-date' };

  // 같은 목표 회차에 대해 최근부터 연속으로 실패한 횟수
  const same = attempts.filter((a) => a.target === target).sort((a, b) => b.at.localeCompare(a.at));
  let misses = 0;
  for (const a of same) {
    if (a.gotNew) break;
    misses++;
  }
  if (misses === 0) return { fetch: true, target, reason: 'due' };
  const next = Date.parse(same[0].at) + backoffMs(misses);
  if (now.getTime() >= next) return { fetch: true, target, reason: 'due' };
  return { fetch: false, target, reason: 'backoff', retryAt: new Date(next).toISOString() };
}
