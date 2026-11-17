import type { Draw, RawDraw } from './types.ts';

/** 1회 추첨: 2002-12-07(토) 20:45 KST = 11:45 UTC */
const FIRST_DRAW_UTC = Date.UTC(2002, 11, 7, 11, 45);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** 추첨 후 결과가 API에 반영될 때까지 여유 시간 */
const PUBLISH_DELAY_MS = 60 * 60 * 1000;

/** 현재 시각 기준으로 결과가 나와 있어야 할 최신 회차 (추정값 — 실제 존재 여부는 API로 확인) */
export function expectedLatestRound(now: Date = new Date()): number {
  const elapsed = now.getTime() - FIRST_DRAW_UTC - PUBLISH_DELAY_MS;
  if (elapsed < 0) return 0;
  return Math.floor(elapsed / WEEK_MS) + 1;
}

export function normalizeDraw(r: RawDraw): Draw {
  const numbers = [r.tm1WnNo, r.tm2WnNo, r.tm3WnNo, r.tm4WnNo, r.tm5WnNo, r.tm6WnNo]
    .map(Number)
    .sort((a, b) => a - b) as Draw['numbers'];
  const ymd = String(r.ltRflYmd);
  return {
    round: Number(r.ltEpsd),
    date: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`,
    numbers,
    bonus: Number(r.bnsWnNo),
    prizes: ([1, 2, 3, 4, 5] as const).map((rank) => ({
      rank,
      winners: Number(r[`rnk${rank}WnNope`] ?? 0),
      amount: Number(r[`rnk${rank}WnAmt`] ?? 0),
    })),
    totalSales: Number(r.wholEpsdSumNtslAmt ?? 0),
    prizePool: Number(r.rlvtEpsdSumNtslAmt ?? 0),
    firstWinType: {
      unknown: Number(r.winType0 ?? 0),
      auto: Number(r.winType1 ?? 0),
      manual: Number(r.winType2 ?? 0),
      semiAuto: Number(r.winType3 ?? 0),
    },
  };
}

/** 단일 회차 유효성 검사. 문제가 있으면 메시지 배열 반환 */
export function validateDraw(d: Draw): string[] {
  const errs: string[] = [];
  const all = [...d.numbers, d.bonus];
  if (all.some((n) => !Number.isInteger(n) || n < 1 || n > 45)) errs.push('번호 범위(1~45) 벗어남');
  if (new Set(all).size !== 7) errs.push('번호/보너스 중복');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) errs.push(`날짜 형식 오류: ${d.date}`);
  return errs;
}

/** 전체 데이터셋 검사: 회차 연속성, 주 단위 간격 */
export function validateDataset(draws: Draw[]): string[] {
  const errs: string[] = [];
  const sorted = [...draws].sort((a, b) => a.round - b.round);
  sorted.forEach((d, i) => {
    for (const e of validateDraw(d)) errs.push(`${d.round}회: ${e}`);
    if (i === 0) {
      if (d.round !== 1) errs.push(`첫 회차가 1이 아님: ${d.round}`);
      return;
    }
    const prev = sorted[i - 1];
    if (d.round !== prev.round + 1) errs.push(`회차 누락: ${prev.round} → ${d.round}`);
    const days = (Date.parse(d.date) - Date.parse(prev.date)) / 86_400_000;
    if (days !== 7) errs.push(`${prev.round}→${d.round}회 간격 ${days}일`);
  });
  return errs;
}
