/**
 * 앱(휴대폰·브라우저) 데이터 저장소
 *  - 기본: 빌드에 포함된 data/draws.json (전체 과거 회차 → 오프라인에서도 모든 분석 가능)
 *  - 추가: 필요할 때만 맥북 서버에서 "보유 회차 이후"를 받아 기기에 덧붙임
 *  - 동행복권에는 요청하지 않음 (맥북 수집기만 요청)
 */
import bundled from '../../data/draws.json';
import type { Draw } from './types.ts';
import { validateDraw } from './normalize.ts';
import { decideFetch, type Attempt, type FetchDecision } from './fetchPolicy.ts';
import type { StoredPurchase, StoredRecommendation } from '../db/repository.ts';

import { API_BASE } from './api.ts';
export { API_BASE, APK_URL, APP_VERSION, APP_VERSION_NAME } from './api.ts';

const EXTRA_KEY = 'lotto.extraDraws.v1';
const ATTEMPTS_KEY = 'lotto.syncAttempts.v1';
const LAST_SYNC_KEY = 'lotto.lastSync.v1';
const PENDING_KEY = 'lotto.pendingPurchases.v1';

function read<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 저장 실패해도 이번 실행 동안은 메모리 데이터로 동작 */
  }
}

export const bundledLatest = (bundled as { latest: number }).latest;

export function getDraws(): Draw[] {
  const map = new Map<number, Draw>();
  // JSON 추론 타입은 numbers를 number[]로 보므로 unknown 경유 (내용은 맥북 수집기에서 검증됨)
  for (const d of (bundled as unknown as { draws: Draw[] }).draws) map.set(d.round, d);
  for (const d of read<Draw[]>(EXTRA_KEY, [])) map.set(d.round, d);
  return [...map.values()].sort((a, b) => a.round - b.round);
}

/** 마지막으로 맥북 서버와 동기화에 성공한 시각 */
export const lastSyncAt = (): string | null => read<string | null>(LAST_SYNC_KEY, null);

export type SyncResult =
  | { status: 'updated'; added: number[] }
  | { status: 'up-to-date'; latest: number }
  | { status: 'skipped'; decision: FetchDecision }
  | { status: 'failed'; error: string };

/**
 * 맥북 서버에서 빠진 회차를 받아 덧붙인다.
 * force=false: 날짜상 새 회차가 있어야 할 때만 요청 (실패 시 1시간 → 6시간 간격)
 */
export async function syncDraws(current: Draw[] = getDraws(), force = false, now = new Date()): Promise<SyncResult> {
  const have = current.at(-1)?.round ?? 0;
  const attempts = read<Attempt[]>(ATTEMPTS_KEY, []);
  const decision = decideFetch(now, have, attempts, force);
  if (!decision.fetch) return decision.reason === 'up-to-date' ? { status: 'up-to-date', latest: have } : { status: 'skipped', decision };

  const record = (gotNew: boolean) => write(ATTEMPTS_KEY, [...attempts, { at: now.toISOString(), target: decision.target, gotNew }].slice(-20));
  try {
    const res = await fetch(`${API_BASE}/draws?after=${have}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`서버 응답 ${res.status}`);
    const body = (await res.json()) as { latest: number; draws: Draw[] };
    const fresh = body.draws.filter((d) => d.round > have && validateDraw(d).length === 0);
    write(LAST_SYNC_KEY, now.toISOString());
    record(fresh.length > 0);
    if (fresh.length === 0) return { status: 'up-to-date', latest: Math.max(have, body.latest) };
    const merged = new Map(read<Draw[]>(EXTRA_KEY, []).map((d) => [d.round, d]));
    for (const d of fresh) merged.set(d.round, d);
    write(EXTRA_KEY, [...merged.values()]);
    return { status: 'updated', added: fresh.map((d) => d.round) };
  } catch (e) {
    record(false);
    const msg = (e as Error).name === 'TimeoutError' ? '맥북 서버 응답 없음 (Tailscale 연결 확인)' : (e as Error).message;
    return { status: 'failed', error: msg };
  }
}

/** 맥북에 기록된 회차별 기본 추천과 채점 결과 (연결 안 되면 null) */
export async function fetchRecommendationHistory(): Promise<StoredRecommendation[] | null> {
  try {
    const res = await fetch(`${API_BASE}/recommendations?limit=400`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    return ((await res.json()) as { recommendations: StoredRecommendation[] }).recommendations;
  } catch {
    return null;
  }
}

// ───────── 구매 기록 (용지 QR → 맥북 DB) ─────────

export type SaveResult = { status: 'saved' | 'duplicate' | 'queued' } | { status: 'error'; error: string };
/** 맥북에 보낼 용지: QR 문자열 또는 직접 입력 */
export type PurchasePayload = { qr: string } | { round: number; games: number[][] };

async function postPurchase(p: PurchasePayload): Promise<'saved' | 'duplicate'> {
  const res = await fetch(`${API_BASE}/purchases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
    signal: AbortSignal.timeout(8_000),
  });
  const body = (await res.json().catch(() => ({}))) as { duplicate?: boolean; error?: string };
  if (res.status === 400) throw Object.assign(new Error(body.error ?? '저장 거부'), { rejected: true });
  if (!res.ok) throw new Error(body.error ?? `서버 응답 ${res.status}`);
  return body.duplicate ? 'duplicate' : 'saved';
}

/** 예전 버전은 QR 문자열만 보관했음 → 객체로 변환 */
const readPending = (): PurchasePayload[] => read<(PurchasePayload | string)[]>(PENDING_KEY, []).map((p) => (typeof p === 'string' ? { qr: p } : p));
const sameTicket = (a: PurchasePayload, b: PurchasePayload) => JSON.stringify(a) === JSON.stringify(b);

/** 맥북에 저장. 연결이 안 되면 기기에 보관했다가 다음 동기화 때 전송 */
export async function savePurchase(p: PurchasePayload): Promise<SaveResult> {
  try {
    return { status: await postPurchase(p) };
  } catch (e) {
    if ((e as { rejected?: boolean }).rejected) return { status: 'error', error: (e as Error).message };
    const q = readPending();
    if (!q.some((x) => sameTicket(x, p))) write(PENDING_KEY, [...q, p]);
    return { status: 'queued' };
  }
}

export const pendingPurchases = (): PurchasePayload[] => readPending();

/** 보관 중인 구매 기록 전송. @returns 전송에 성공한 개수 */
export async function flushPendingPurchases(): Promise<number> {
  const q = readPending();
  if (q.length === 0) return 0;
  const left: PurchasePayload[] = [];
  let sent = 0;
  for (const p of q) {
    try {
      await postPurchase(p);
      sent++;
    } catch (e) {
      if (!(e as { rejected?: boolean }).rejected) left.push(p); // 거부된 건 버림, 연결 실패만 다시 시도
    }
  }
  write(PENDING_KEY, left);
  return sent;
}

/** 당첨금 수령 표시 */
export async function setClaimed(key: string, slot: number, claimed: boolean): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/purchases/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, slot, claimed }),
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ───────── 앱 버전 ─────────

export interface AppRelease {
  versionCode: number;
  versionName: string;
  size: number;
  builtAt: string;
}

/** 맥북에 배포된 최신 앱 (없거나 연결 안 되면 null) */
export async function fetchLatestApp(): Promise<AppRelease | null> {
  try {
    const res = await fetch(`${API_BASE}/app`, { signal: AbortSignal.timeout(8_000) });
    return res.ok ? ((await res.json()) as AppRelease) : null;
  } catch {
    return null;
  }
}

/** 맥북에 저장된 구매 기록 (연결 안 되면 null) */
export async function fetchPurchases(): Promise<StoredPurchase[] | null> {
  try {
    const res = await fetch(`${API_BASE}/purchases`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    return ((await res.json()) as { purchases: StoredPurchase[] }).purchases;
  } catch {
    return null;
  }
}

export async function deletePurchase(key: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/purchases?key=${encodeURIComponent(key)}`, { method: 'DELETE', signal: AbortSignal.timeout(8_000) });
    return res.ok;
  } catch {
    return false;
  }
}
