import '@fontsource/jua/korean-400.css';
import '@fontsource/jua/latin-400.css';
import './style.css';
import type { Draw } from './data/types.ts';
import {
  APK_URL, APP_VERSION, APP_VERSION_NAME, deletePurchase, fetchLatestApp, fetchPurchases, fetchRecommendationHistory, flushPendingPurchases, getDraws,
  lastSyncAt, pendingPurchases, savePurchase, setClaimed, syncDraws, type PurchasePayload,
} from './data/store.ts';
import { enteredTicket, parseLottoQr, QrError, type Ticket } from './data/qr.ts';
import { expectedLatestRound } from './data/normalize.ts';
import type { RecommendResult } from './recommend/recommend.ts';
import { isNative, notifyEnabled, onNotificationTap, scheduleNotifications, setNotify, updateWidget } from './app/native.ts';
import { scanQr } from './app/scanner.ts';
import { cachedHome, cachedPeriod, computeHome, computePeriod, reRecommend } from './app/compute.ts';
import type { HomeResults, PeriodResults } from './app/results.ts';
import { destroyCharts } from './app/charts.ts';
import { loadPeriodSel, MIN_DRAWS, PRESETS, resolvePeriod, savePeriodSel, type PeriodSel } from './app/period.ts';
import { ICONS, type ServerData, type View, type ViewCtx } from './app/view.ts';
import { entryFormHtml, fixedFormHtml, homeView, picksText, ticketPreviewHtml, ticketSheetHtml } from './app/views-home.ts';
import { buyView } from './app/views-buy.ts';
import { statsView } from './app/views-stats.ts';
import { testsView } from './app/views-tests.ts';
import { settingsView } from './app/views-settings.ts';
import { $, esc, won } from './app/ui.ts';

/** 홈 추천 방식 기억 (state 초기화에서 쓰므로 가장 위에) */
const STRATEGY_KEY = 'lotto.strategy.v1';

const VIEWS: View[] = [homeView, buyView, statsView, testsView, settingsView];
const NAV = VIEWS.filter((v) => v.inNav);

const state: {
  draws: Draw[];
  home: HomeResults | null;
  /** "다른 조합"·고정 번호로 바꾼 추천 (없으면 기본 추천) */
  rec: RecommendResult | null;
  fixed: number[];
  /** 홈에서 고른 추천 방식 (기기에 기억) */
  strategy: 'default' | 'hot';
  period: PeriodResults | null;
  sel: PeriodSel;
  view: string;
  status: string;
  error: string;
  /** 맥북 수집 지연·연결 경고 */
  banner: string | null;
  server: ServerData;
  notify: boolean;
  online: boolean | null;
} = {
  draws: getDraws(),
  home: null,
  rec: null,
  fixed: [],
  strategy: loadStrategy(),
  period: null,
  sel: loadPeriodSel(),
  view: VIEWS.some((v) => v.key === location.hash.slice(1)) ? location.hash.slice(1) : 'home',
  status: '',
  error: '',
  banner: null,
  server: { purchases: undefined, recs: undefined, latestApp: undefined, pending: pendingPurchases().length },
  notify: false,
  online: null,
};

function loadStrategy(): 'default' | 'hot' {
  try {
    return localStorage.getItem(STRATEGY_KEY) === 'hot' ? 'hot' : 'default';
  } catch {
    return 'default';
  }
}

/** 선택한 방식의 기본 추천 */
const baseRec = () => (state.strategy === 'hot' ? state.home?.hotRecommendation : state.home?.recommendation) ?? null;

const range = () => resolvePeriod(state.sel, state.draws);
const lastRound = () => state.draws.at(-1)!.round;
const currentView = () => VIEWS.find((v) => v.key === state.view)!;
const usesPeriod = (v: View) => (typeof v.usesPeriod === 'function' ? v.usesPeriod() : v.usesPeriod);
const CELEBRATED_KEY = 'lotto.celebrated.v1';

$('#app')!.innerHTML = `
  <header class="app-header">
    <div class="app-title">
      <h1>로또 통계</h1>
      <div class="sync">
        <span id="sync-text"></span>
        <button class="icon-btn" id="btn-sync" aria-label="맥북에서 새 회차 받기">${ICONS.refresh}</button>
        <button class="icon-btn" id="btn-settings" aria-label="설정">${ICONS.gear}</button>
      </div>
    </div>
    <div class="period-bar" id="period-bar"></div>
  </header>
  <div id="banners"></div>
  <main id="view"></main>
  <nav class="bottom-nav">${NAV.map((v) => `<button data-view="${v.key}">${v.icon}<span>${v.label}</span></button>`).join('')}</nav>`;

// ───────── 렌더링 ─────────

function renderHeader() {
  const dot = state.online === null ? '' : `<span class="dot ${state.online ? 'ok' : 'sig'}" title="${state.online ? '맥북 연결됨' : '맥북 연결 안 됨'}">●</span> `;
  $('#sync-text')!.innerHTML = state.status ? esc(state.status) : `${dot}${lastRound()}회`;
  $('#btn-settings')!.classList.toggle('on', state.view === 'settings');
  const view = currentView();
  const bar = $('#period-bar')!;
  bar.hidden = !usesPeriod(view);
  if (bar.hidden) return;
  const r = range();
  bar.innerHTML = `
    <div class="chips">${PRESETS.map((p) => `<button class="chip ${p.key === state.sel.key ? 'on' : ''}" data-period="${p.key}">${p.label}</button>`).join('')}</div>
    ${state.sel.key === 'custom'
      ? `<form class="custom" id="custom-form"><input inputmode="numeric" name="from" value="${r.from}" aria-label="시작 회차">~<input inputmode="numeric" name="to" value="${r.to}" aria-label="끝 회차">회<button class="btn sm">적용</button></form>`
      : ''}
    <div class="range">${esc(r.label)} · ${r.count.toLocaleString()}회</div>
    ${state.sel.key === 'custom' ? '<div class="range warn">기간을 여러 번 바꿔 볼수록 우연한 "유의"가 늘어납니다</div>' : ''}`;
}

/** 모든 화면 위: 새 버전 안내 · 수집 지연 경고 (한 줄씩) */
function renderBanners() {
  const latest = state.server.latestApp;
  const update = isNative && APP_VERSION !== null && latest && latest.versionCode > APP_VERSION
    ? `<div class="update"><span>새 버전 <b>${esc(latest.versionName)}</b> <span class="muted small">(지금 ${esc(APP_VERSION_NAME ?? '')} · ${(latest.size / 1e6).toFixed(1)}MB)</span></span><button class="btn sm primary" data-update>받기</button></div>`
    : '';
  const warn = state.banner ? `<p class="banner">${esc(state.banner)}</p>` : '';
  $('#banners')!.innerHTML = update + celebrate() + warn;
}

/** 최신 회차에 산 용지가 당첨됐으면 한 번 축하 (닫으면 그 회차는 다시 안 띄움) */
function celebrate(): string {
  const round = lastRound();
  const wins = (state.server.purchases ?? []).filter((p) => p.targetRound === round && (p.prizeRank ?? 0) > 0);
  let seen = '';
  try {
    seen = localStorage.getItem(CELEBRATED_KEY) ?? '';
  } catch {
    /* 저장소 없음 */
  }
  if (!wins.length || seen === String(round)) return '';
  const best = Math.min(...wins.map((p) => p.prizeRank!));
  return `<div class="celebrate"><span>🎉 <b>${round}회 ${best}등 당첨!</b> ${wins.length}게임 · ${won(wins.reduce((a, p) => a + (p.prizeAmount ?? 0), 0))}</span><button class="icon-btn" data-celebrated aria-label="닫기">✕</button></div>`;
}

function ctx(): ViewCtx {
  return {
    draws: state.draws,
    period: state.period,
    range: range(),
    home: state.home,
    rec: state.rec ?? baseRec(),
    strategy: state.strategy,
    server: state.server,
    settings: { native: isNative, notify: state.notify, version: APP_VERSION_NAME, versionCode: APP_VERSION, online: state.online, lastSync: lastSyncAt() },
    rerender: () => render(false),
  };
}

function render(resetScroll = false) {
  destroyCharts();
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
  renderHeader();
  renderBanners();
  const view = currentView();
  const c = ctx();
  const y = window.scrollY;
  $('#view')!.innerHTML = (state.error ? `<p class="error">${esc(state.error)}</p>` : '') + view.render(c);
  view.after?.(c);
  window.scrollTo({ top: resetScroll ? 0 : y });
  if (usesPeriod(view)) void ensurePeriod();
}

/** 화면 이동. 설정은 기록을 쌓아 휴대폰 뒤로가기로 돌아올 수 있게 (그 외 탭은 바꿔치기) */
function go(view: string) {
  if (view === state.view) return;
  if (view === 'settings') history.pushState(null, '', `#${view}`);
  else history.replaceState(null, '', `#${view}`);
  state.view = view;
  render(true);
}

window.addEventListener('popstate', () => {
  const v = location.hash.slice(1);
  state.view = VIEWS.some((x) => x.key === v) ? v : 'home';
  render(true);
});

function flash(msg: string) {
  state.status = msg;
  renderHeader();
  setTimeout(() => {
    if (state.status === msg) {
      state.status = '';
      renderHeader();
    }
  }, 4000);
}

// ───────── 시트 (확인 · 입력) ─────────

/** 확인 시트: 확인(true) / 취소(false) */
function confirmSheet(html: string, ok: string, cancel = '취소'): Promise<boolean> {
  return formSheet(html, ok, () => true, undefined, cancel).then((v) => v === true);
}

/** 입력 시트: 확인을 누르면 read()로 값을 읽음. 문자열을 돌려주면 오류로 보여주고 시트를 유지 */
function formSheet<T>(html: string, ok: string, read: (el: HTMLElement) => T | string, onOpen?: (el: HTMLElement) => void, cancel = '취소'): Promise<T | null> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'sheet-backdrop';
    el.innerHTML = `<div class="sheet">${html}<p class="line warn-text" data-err hidden></p><div class="actions"><button class="btn" data-v="0">${cancel}</button><button class="btn primary" data-v="1">${ok}</button></div></div>`;
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-v]');
      if (!b && e.target !== el) return;
      if (b?.dataset.v === '1') {
        const v = read(el);
        if (typeof v === 'string') {
          const err = el.querySelector<HTMLElement>('[data-err]')!;
          err.textContent = v;
          err.hidden = false;
          return;
        }
        el.remove();
        return resolve(v);
      }
      el.remove();
      resolve(null);
    });
    document.body.append(el);
    onOpen?.(el);
  });
}

// ───────── 구매 기록 ─────────

/** QR 스캔 → 내용 확인 → 맥북에 저장 (연결 안 되면 기기에 보관) */
async function scanFlow() {
  const qr = await scanQr();
  if (!qr) return;
  let ticket;
  try {
    ticket = parseLottoQr(qr);
  } catch (e) {
    return flash(e instanceof QrError ? e.message : 'QR을 읽을 수 없습니다');
  }
  if (!(await confirmSheet(ticketPreviewHtml(ticket, lastRound() + 1), '저장'))) return;
  await store(ticket, { qr });
}

/** QR이 안 읽힐 때: 회차·번호 직접 입력 → 확인 → 저장 */
async function entryFlow() {
  const res = await formSheet(
    entryFormHtml(lastRound() + 1),
    '확인',
    (el) => {
      const round = Number(el.querySelector<HTMLInputElement>('[name=round]')!.value);
      const games: number[][] = [];
      for (const row of el.querySelectorAll('.entry-row')) {
        const vals = [...row.querySelectorAll('input')].map((i) => i.value.trim());
        if (vals.every((v) => v === '')) continue;
        games.push(vals.map(Number));
      }
      try {
        return { ticket: enteredTicket(round, games), payload: { round, games } };
      } catch (e) {
        return e instanceof QrError ? e.message : '입력을 확인해 주세요';
      }
    },
    (el) => el.querySelector<HTMLInputElement>('.entry-row input')?.focus(),
  );
  if (!res) return;
  if (!(await confirmSheet(ticketPreviewHtml(res.ticket, lastRound() + 1), '저장'))) return;
  await store(res.ticket, res.payload);
}

async function store(ticket: Ticket, payload: PurchasePayload) {
  const r = await savePurchase(payload);
  flash(
    r.status === 'saved' ? `${ticket.round}회 ${ticket.games.length}게임 저장` :
    r.status === 'duplicate' ? '이미 저장된 용지' :
    r.status === 'queued' ? '맥북 연결 안 됨 — 기기에 보관, 연결되면 전송' : 'error' in r ? r.error : '',
  );
  state.server.pending = pendingPurchases().length;
  await loadServer();
}

/** 맥북에서 구매 기록·추천 기록·최신 앱 버전을 받아 다시 그림 */
async function loadServer() {
  const [purchases, recs, latestApp] = await Promise.all([fetchPurchases(), fetchRecommendationHistory(), fetchLatestApp()]);
  state.server = { purchases, recs, latestApp, pending: pendingPurchases().length };
  state.online = purchases !== null;
  void scheduleNotifications(expectedLatestRound() + 1, new Set((purchases ?? []).map((p) => p.targetRound)));
  if (state.view === 'home' || state.view === 'buy' || state.view === 'settings') render();
  else renderBanners();
}

// ───────── 계산 ─────────

let homeBusy = false;

/** 이번 주 추천 (기간 무관, 전체 회차 규칙 감시) */
async function ensureHome() {
  state.home = cachedHome(lastRound());
  if (!state.home && !homeBusy) {
    homeBusy = true;
    try {
      state.home = await computeHome(state.draws);
    } catch (e) {
      state.error = `계산 오류: ${(e as Error).message}`;
    } finally {
      homeBusy = false;
    }
  }
  const b = baseRec();
  if (b) void updateWidget(b.targetRound, b.picks.map((p) => p.numbers));
  if (state.view === 'home') render();
}

let periodToken = 0;
let periodKey = '';

/** 선택 기간 통계 (통계·검정 탭을 열 때만 계산) */
async function ensurePeriod() {
  const r = range();
  const key = `${lastRound()}:${r.from}:${r.to}`;
  if ((state.period && periodKey === key) || periodKey === `err:${key}`) return;
  const cached = cachedPeriod(lastRound(), r.from, r.to);
  if (cached) {
    state.period = cached;
    periodKey = key;
    if (usesPeriod(currentView())) render();
    return;
  }
  if (periodKey === `busy:${key}`) return;
  periodKey = `busy:${key}`;
  state.period = null;
  const token = ++periodToken;
  try {
    const res = await computePeriod(state.draws, r.from, r.to);
    if (token !== periodToken) return; // 그 사이 기간이 바뀜 → 버림
    state.period = res;
    periodKey = key;
  } catch (e) {
    state.error = `계산 오류: ${(e as Error).message}`;
    periodKey = `err:${key}`; // 같은 기간은 다시 시도하지 않음 (무한 반복 방지)
  }
  if (usesPeriod(currentView())) render();
}

async function sync(force: boolean) {
  const btn = $<HTMLButtonElement>('#btn-sync')!;
  btn.disabled = true;
  btn.classList.add('spin');
  state.status = '확인 중…';
  renderHeader();
  const sent = await flushPendingPurchases();
  const r = await syncDraws(state.draws, force);
  btn.disabled = false;
  btn.classList.remove('spin');
  // 날짜상 새 회차가 없으면 서버에 묻지 않으므로, 연결 여부는 실제 응답(실패·새 회차·구매 기록)으로만 판단
  if (r.status === 'failed') state.online = false;
  else if (r.status === 'updated') state.online = true;
  // 추첨 결과 공개 12시간 뒤에도 새 회차가 없으면 경고 (맥북 연결 실패 / 맥북 수집 지연 구분)
  const due = expectedLatestRound(new Date(Date.now() - 12 * 3_600_000));
  const have = r.status === 'updated' ? Math.max(...r.added) : lastRound();
  if (r.status === 'failed') state.banner = have < due ? `맥북 연결 안 됨 — ${due}회를 아직 못 받았습니다 (Tailscale·맥북 확인)` : null;
  else if (r.status === 'up-to-date') state.banner = r.latest < due ? `맥북 수집 지연 — ${due}회가 맥북에 아직 없습니다 (동행복권 반영 지연 또는 수집기 확인)` : null;
  else if (r.status === 'updated') state.banner = null;

  if (r.status === 'updated') {
    state.draws = getDraws();
    state.status = `+${r.added.join(', ')}회`;
    state.home = null;
    state.rec = null;
    state.period = null;
    periodKey = '';
    void ensureHome();
  } else {
    state.status = r.status === 'failed' ? '맥북 연결 안 됨' : r.status === 'skipped' ? '잠시 후 재시도' : force ? '최신' : '';
  }
  render();
  if (sent || force || r.status === 'updated' || state.server.purchases === undefined) void loadServer();
  setTimeout(() => {
    state.status = '';
    renderHeader();
  }, 4000);
}

// ───────── 이벤트 (화면이 바뀌어도 유지되도록 위임) ─────────

document.querySelector('.bottom-nav')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-view]');
  if (b) go(b.dataset.view!);
});
$('#btn-settings')!.addEventListener('click', () => go(state.view === 'settings' ? 'home' : 'settings'));
$('#btn-sync')!.addEventListener('click', () => void sync(true));

/** 업데이트: 앱 밖(브라우저)에서 열어야 APK 설치 화면으로 이어짐 — Capacitor는 외부 주소를 시스템 브라우저로 넘김 */
const openUpdate = () => {
  location.href = APK_URL;
};
$('#banners')!.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('[data-update]')) openUpdate();
  if (t.closest('[data-celebrated]')) {
    try {
      localStorage.setItem(CELEBRATED_KEY, String(lastRound()));
    } catch {
      /* 저장소 없음 */
    }
    renderBanners();
  }
});

/** 클립보드 복사 (WebView에서 Clipboard API가 막히면 예전 방식) */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

$('#view')!.addEventListener('click', async (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('[data-scan]')) return void scanFlow();
  if (t.closest('[data-entry]')) return void entryFlow();

  // 홈: 용지 보기 (큰 글씨 + 복사)
  if (t.closest('#btn-sheet')) {
    const rec = state.rec ?? baseRec();
    if (!rec) return;
    const copy = await confirmSheet(ticketSheetHtml(rec), '복사', '닫기');
    if (copy) flash((await copyText(picksText(rec))) ? '추천 번호 복사됨' : '복사 실패');
    return;
  }

  // 홈: 추천 방식 (기본 / 핫 번호)
  const st = t.closest<HTMLButtonElement>('[data-strategy]');
  if (st) {
    const v = st.dataset.strategy === 'hot' ? 'hot' : 'default';
    if (v === state.strategy) return;
    state.strategy = v;
    state.rec = null;
    state.fixed = [];
    try {
      localStorage.setItem(STRATEGY_KEY, v);
    } catch {
      /* 저장소 없음 */
    }
    const b = baseRec();
    if (b) void updateWidget(b.targetRound, b.picks.map((p) => p.numbers));
    return render();
  }

  // 홈: 다른 조합 · 번호 고정
  if (t.closest('#btn-regen') || t.closest('#btn-fixed')) {
    const btn = t.closest<HTMLButtonElement>('button')!;
    let fixed = state.fixed;
    if (btn.id === 'btn-fixed') {
      const picked = await formSheet(fixedFormHtml(state.fixed), '적용', (el) => [...el.querySelectorAll<HTMLElement>('.num-pick.on')].map((b) => Number(b.dataset.num)), (el) =>
        el.querySelector('.num-grid')!.addEventListener('click', (ev) => {
          const nb = (ev.target as HTMLElement).closest<HTMLElement>('.num-pick');
          if (!nb) return;
          if (!nb.classList.contains('on') && el.querySelectorAll('.num-pick.on').length >= 5) return;
          nb.classList.toggle('on');
        }),
      );
      if (picked === null) return;
      fixed = picked;
    }
    btn.disabled = true;
    try {
      state.fixed = fixed;
      // 고정 번호만 바꾸면 기본 시드 유지, "다른 조합"이면 새 시드
      const seed = btn.id === 'btn-regen' ? Math.floor(Math.random() * 2 ** 31) : (state.rec?.seed ?? lastRound() + 1);
      state.rec = fixed.length === 0 && btn.id === 'btn-fixed' && seed === lastRound() + 1 ? null : await reRecommend(state.draws, seed, state.home?.disabled ?? [], fixed, state.strategy);
    } catch (err) {
      flash((err as Error).message);
    }
    return render();
  }

  // 내 구매: 수령 표시 · 용지 삭제
  const claim = t.closest<HTMLButtonElement>('[data-claim]');
  if (claim) {
    claim.disabled = true;
    if (!(await setClaimed(claim.dataset.claim!, Number(claim.dataset.slot), claim.dataset.claimed !== '1'))) flash('저장 실패 (맥북 연결 확인)');
    return void loadServer();
  }
  const del = t.closest<HTMLButtonElement>('[data-del-ticket]');
  if (del) {
    if (del.dataset.confirm !== '1') {
      // 실수 방지: 한 번 더 눌러야 삭제
      del.dataset.confirm = '1';
      del.textContent = '한 번 더 누르면 삭제';
      return;
    }
    del.disabled = true;
    flash((await deletePurchase(del.dataset.delTicket!)) ? '용지 삭제됨' : '삭제 실패 (맥북 연결 확인)');
    return void loadServer();
  }

  // 설정
  if (t.id === 'btn-notify') {
    const want = !state.notify;
    state.notify = await setNotify(want);
    if (want && !state.notify) flash('알림 권한이 없습니다 (휴대폰 설정 → 앱 → 로또 통계 → 알림)');
    void scheduleNotifications(expectedLatestRound() + 1, new Set((state.server.purchases ?? []).map((p) => p.targetRound)));
    return render();
  }
  if (t.id === 'btn-update') return openUpdate();
  if (t.id === 'btn-sync-now') return void sync(true);
});

$('#period-bar')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-period]');
  if (!b) return;
  const key = b.dataset.period as PeriodSel['key'];
  if (key === state.sel.key && key !== 'custom') return;
  const r = range();
  state.sel = key === 'custom' ? { key, from: r.from, to: r.to } : { key };
  savePeriodSel(state.sel);
  render();
});

$('#period-bar')!.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(e.target as HTMLFormElement);
  const from = Number(f.get('from'));
  const to = Number(f.get('to'));
  if (!Number.isInteger(from) || !Number.isInteger(to)) return;
  state.sel = { key: 'custom', from, to };
  savePeriodSel(state.sel);
  const r = range();
  if (r.count === MIN_DRAWS && Math.abs(to - from) + 1 < MIN_DRAWS) flash(`최소 ${MIN_DRAWS}회로 조정`);
  render();
});

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => render());

// 앱: 알림을 누르거나 다시 앞으로 올 때 새 회차·새 버전 확인 (새 회차는 날짜상 필요할 때만 요청)
onNotificationTap(() => void sync(false));
if (isNative)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sync(false);
  });

// ───────── 시작 ─────────

(async () => {
  state.notify = await notifyEnabled();
  render(true);
  await ensureHome();
  await sync(false);
  // 통계·검정 탭을 열 때 기다리지 않도록 선택 기간 결과를 미리 계산 (홈 계산이 끝난 뒤)
  void ensurePeriod();
})();
