/**
 * Android 앱 전용 기능 — 웹 화면(브라우저)에서는 아무것도 하지 않음
 *  - 토요일 알림: 19:00 구매 마감 1시간 전(그 회차를 아직 스캔 안 했을 때만), 21:00 추첨 결과 확인
 *    앞으로 4주치를 날짜로 예약하고, 앱을 열거나 용지를 저장할 때마다 다시 예약 (휴대폰 자체 알림, 외부 푸시 없음)
 *  - 홈 화면 위젯: 이번 주 추천 번호를 SharedPreferences에 써 두고 위젯을 새로 그리게 함
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Preferences } from '@capacitor/preferences';

export const isNative = Capacitor.isNativePlatform();

const NOTIFY_KEY = 'lotto.notify.v1';
/** 예전(1.1~1.2) 매주 반복 알림 id + 지금 쓰는 4주치 id */
const OLD_IDS = [1, 2];
const WEEKS = 4;
const weekIds = () => Array.from({ length: WEEKS * 2 }, (_, i) => 100 + i);
const FIRST_DRAW = Date.UTC(2002, 11, 7);

/** R회 추첨일(한국 날짜) */
const drawDay = (round: number) => new Date(FIRST_DRAW + (round - 1) * 7 * 86_400_000).toISOString().slice(0, 10);

/** MainActivity에 등록한 위젯 갱신 플러그인 (android/.../LottoWidgetPlugin.java) */
const LottoWidget = registerPlugin<{ refresh(): Promise<void> }>('LottoWidget');

export async function notifyEnabled(): Promise<boolean> {
  if (!isNative) return false;
  return (await Preferences.get({ key: NOTIFY_KEY })).value === '1';
}

/**
 * 알림 예약: 다가오는 토요일부터 4주.
 * @param nextRound 다가오는 추첨 회차
 * @param bought 이미 용지를 저장한 회차 (그 주의 19:00 마감 알림은 생략)
 */
export async function scheduleNotifications(nextRound: number, bought: ReadonlySet<number>) {
  if (!isNative) return;
  await LocalNotifications.cancel({ notifications: [...OLD_IDS, ...weekIds()].map((id) => ({ id })) });
  if (!(await notifyEnabled())) return;
  const now = Date.now();
  const list = [];
  for (let k = 0; k < WEEKS; k++) {
    const round = nextRound + k;
    const day = drawDay(round);
    const deadline = new Date(`${day}T19:00:00+09:00`);
    const result = new Date(`${day}T21:00:00+09:00`);
    if (!bought.has(round) && deadline.getTime() > now)
      list.push({ id: 100 + k * 2, title: `${round}회 아직 구매 기록 없음`, body: '판매는 20:00에 마감됩니다. 구매했다면 용지 QR을 스캔하세요.', schedule: { at: deadline, allowWhileIdle: true } });
    if (result.getTime() > now)
      list.push({ id: 101 + k * 2, title: `${round}회 추첨 결과 확인`, body: '앱을 열면 맥북에서 새 회차를 받아 채점합니다 (Tailscale 켜기).', schedule: { at: result, allowWhileIdle: true } });
  }
  if (list.length) await LocalNotifications.schedule({ notifications: list });
}

/** 알림 켜기/끄기. 권한을 거부하면 false. 켠 뒤 scheduleNotifications로 예약 */
export async function setNotify(on: boolean): Promise<boolean> {
  if (!isNative) return false;
  if (on && (await LocalNotifications.requestPermissions()).display !== 'granted') on = false;
  await Preferences.set({ key: NOTIFY_KEY, value: on ? '1' : '0' });
  if (!on) await LocalNotifications.cancel({ notifications: [...OLD_IDS, ...weekIds()].map((id) => ({ id })) });
  return on;
}

/** 알림을 눌러 앱이 열리면 실행할 동작 */
export function onNotificationTap(fn: () => void) {
  if (isNative) void LocalNotifications.addListener('localNotificationActionPerformed', () => fn());
}

/** 위젯에 이번 주 추천 표시 */
export async function updateWidget(round: number, picks: number[][]) {
  if (!isNative) return;
  await Preferences.set({ key: 'widget', value: JSON.stringify({ round, picks }) });
  try {
    await LottoWidget.refresh();
  } catch {
    /* 위젯 플러그인 없는 이전 버전 */
  }
}
