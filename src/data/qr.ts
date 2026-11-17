/**
 * 로또 6/45 용지 QR 해석
 *
 * 용지 QR은 동행복권 당첨 확인 주소이고, 번호는 v 파라미터에 들어 있다 (공식 명세는 없음 — 실제 용지로 확인):
 *   https://m.dhlottery.co.kr/?v=1251q030914273341m010612213645n000000000000…1234567890
 *   └ 회차(숫자) · 게임마다 [구분 글자 1개 + 두 자리 번호 6개] · 끝에 용지 일련번호(숫자)
 *   구분 글자: q = 자동, m = 수동, s = 반자동, n = 빈 게임(000000000000)
 * 주소로 접속하지 않고 문자열만 해석한다.
 */
export type GameMode = 'auto' | 'manual' | 'semi' | 'unknown';

export interface TicketGame {
  /** A~E 중 몇 번째 줄인지 (0부터) */
  slot: number;
  mode: GameMode;
  numbers: number[];
}

export interface Ticket {
  round: number;
  games: TicketGame[];
  /** v 값 그대로 — 같은 용지를 두 번 스캔해도 한 번만 저장하기 위한 키 */
  key: string;
}

const MODES: Record<string, GameMode> = { q: 'auto', m: 'manual', s: 'semi' };

export class QrError extends Error {}

/** QR 문자열 → 용지. 로또 6/45 용지가 아니거나 번호가 이상하면 QrError */
export function parseLottoQr(text: string): Ticket {
  const raw = text.trim();
  let v: string | null = null;
  try {
    v = new URL(raw).searchParams.get('v');
  } catch {
    // 주소 형식이 아니면 v= 이후를 직접 찾음
    v = /[?&]v=([0-9a-z]+)/i.exec(raw)?.[1] ?? null;
  }
  if (!v) throw new QrError('로또 용지 QR이 아닙니다');
  v = v.toLowerCase();
  const head = /^(\d{3,5})(?=[a-z])/.exec(v);
  if (!head) throw new QrError('회차를 읽을 수 없습니다');
  const round = Number(head[1]);
  const games: TicketGame[] = [];
  const re = /([a-z])(\d{12})/gy;
  re.lastIndex = head[1].length;
  let slot = 0;
  for (let m = re.exec(v); m; m = re.exec(v), slot++) {
    if (m[2] === '000000000000') continue; // 빈 줄
    const numbers = m[2].match(/\d\d/g)!.map(Number);
    if (numbers.some((n) => n < 1 || n > 45) || new Set(numbers).size !== 6) throw new QrError(`${slot + 1}번째 게임 번호가 올바르지 않습니다`);
    games.push({ slot, mode: MODES[m[1]] ?? 'unknown', numbers: numbers.sort((a, b) => a - b) });
  }
  if (games.length === 0 || games.length > 5) throw new QrError('게임을 읽을 수 없습니다');
  return { round, games, key: v };
}

export const MODE_LABEL: Record<GameMode, string> = { auto: '자동', manual: '수동', semi: '반자동', unknown: '?' };
