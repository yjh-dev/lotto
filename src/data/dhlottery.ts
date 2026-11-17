/**
 * 동행복권 API 클라이언트 — 맥북 수집기 전용 (휴대폰 앱은 맥북 서버에만 요청)
 *
 * GET /lt645/selectPstLt645InfoNew.do?srchDir=center&srchLtEpsd=N
 *   → N을 중심으로 N+4 ~ N-5 (최대 10개). 위쪽이 없으면 아래로 채움
 *     (예: 1100 → 1104~1095, 1250(최신) → 1250~1241, 1 → 10~1). 비공개 API라 변경될 수 있음.
 */
import type { RawDraw } from './types.ts';

export const DH_ENDPOINT = 'https://www.dhlottery.co.kr/lt645/selectPstLt645InfoNew.do';
const REQUEST_GAP_MS = 1000;
const MAX_RETRY = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWindow(center: number, fetchImpl: typeof fetch = fetch): Promise<RawDraw[]> {
  const url = `${DH_ENDPOINT}?srchDir=center&srchLtEpsd=${center}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', Referer: 'https://www.dhlottery.co.kr/lt645/result' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data?: { list?: RawDraw[] } };
      return body.data?.list ?? [];
    } catch (e) {
      if (attempt >= MAX_RETRY) throw new Error(`${center}회 요청 실패: ${(e as Error).message}`);
      await sleep(REQUEST_GAP_MS * 2 ** attempt);
    }
  }
}

/**
 * have 이후 ~ upTo까지의 회차를 받아온다 (10개씩, 요청 간 1초 간격).
 * upTo 회차가 아직 반영 전이면 받을 수 있는 데까지만 반환.
 */
export async function fetchRange(
  have: number,
  upTo: number,
  opts: { fetchImpl?: typeof fetch; onProgress?: (done: number, total: number) => void } = {},
): Promise<RawDraw[]> {
  const got = new Map<number, RawDraw>();
  let cursor = upTo;
  const total = Math.ceil(Math.max(0, upTo - have) / 10);
  let n = 0;
  while (cursor > have) {
    // center = cursor-4 → cursor ~ cursor-9 반환 (최신 근처에선 위쪽이 비어 있음)
    const list = await fetchWindow(Math.max(1, cursor - 4), opts.fetchImpl);
    n++;
    opts.onProgress?.(n, total);
    if (list.length === 0) break;
    for (const r of list) if (Number(r.ltEpsd) > have) got.set(Number(r.ltEpsd), r);
    const min = Math.min(...list.map((x) => Number(x.ltEpsd)));
    if (min >= cursor) break; // 진전 없음 (최신 회차 미반영 등)
    cursor = min - 1;
    if (cursor > have) await sleep(REQUEST_GAP_MS);
  }
  return [...got.values()].sort((a, b) => Number(a.ltEpsd) - Number(b.ltEpsd));
}
