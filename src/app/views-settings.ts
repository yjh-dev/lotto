/** 설정 (오른쪽 위 톱니바퀴): 맥북 연결 · 토요일 알림 · 앱 버전 · 백업 안내 */
import { ICONS, type View } from './view.ts';
import { card, esc } from './ui.ts';

export const settingsView: View = {
  key: 'settings',
  label: '설정',
  icon: ICONS.gear,
  usesPeriod: false,
  render: (c) => {
    const s = c.settings;
    const latest = c.server.latestApp;
    const update = s.native && latest && s.versionCode !== null && latest.versionCode > s.versionCode;
    const row = (label: string, note: string, right: string) => `<div class="set-row"><span>${label}<span class="muted small set-note">${note}</span></span>${right}</div>`;
    const conn =
      s.online === null ? '확인 전' : s.online ? '<span class="dot ok">●</span> 연결됨' : '<span class="dot sig">●</span> 연결 안 됨';
    return (
      card(
        '맥북 서버',
        row('연결', `${s.lastSync ? `마지막 새 회차 확인 ${new Date(s.lastSync).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}${s.online === false ? `${s.lastSync ? ' · ' : ''}Tailscale을 켜야 연결됩니다` : ''}`, `<span class="small">${conn}</span>`) +
          row('데이터', `${c.draws.length.toLocaleString()}회 보유 · 최신 ${c.draws.at(-1)!.round}회`, '<button class="btn sm" id="btn-sync-now">지금 확인</button>') +
          row('백업', '새 회차 수집·용지 저장 때 맥북이 iCloud Drive에 자동 백업', ''),
      ) +
      card(
        '알림',
        row('토요일 알림', '19:00 그 주 구매 기록이 없으면 마감 알림 · 21:00 결과 확인', s.native ? `<button class="btn sm ${s.notify ? 'primary' : ''}" id="btn-notify">${s.notify ? '켜짐' : '꺼짐'}</button>` : '<span class="muted small nowrap">앱에서만</span>'),
      ) +
      card(
        '앱',
        row('버전', `${s.version ? `지금 ${esc(s.version)}` : '웹 화면'}${latest ? ` · 최신 ${esc(latest.versionName)}` : latest === null ? ' · 최신 확인 불가' : ''}`, update ? '<button class="btn sm primary" id="btn-update">새 버전 받기</button>' : s.native && latest ? '<span class="muted small nowrap">최신</span>' : ''),
      )
    );
  },
};
