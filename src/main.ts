import './style.css';
import type { Draw } from './data/types.ts';
import {
  deletePurchase, fetchPurchases, fetchRecommendationHistory, flushPendingPurchases, getDraws, lastSyncAt, pendingPurchases, savePurchaseQr, syncDraws,
} from './data/store.ts';
import { parseLottoQr, QrError } from './data/qr.ts';
import { scanQr } from './app/scanner.ts';
import { cachedPeriod, computePeriod, reRecommend } from './app/compute.ts';
import type { PeriodResults } from './app/results.ts';
import { destroyCharts } from './app/charts.ts';
import { loadPeriodSel, MIN_DRAWS, PRESETS, resolvePeriod, savePeriodSel, type PeriodSel } from './app/period.ts';
import { ICONS, type View, type ViewCtx } from './app/view.ts';
import { historyHtml, homeView, oddsHtml, picksFooter, picksHtml, purchasesHtml, thetaOf, ticketPreviewHtml, type HomeState } from './app/views-home.ts';
import { numbersView, patternsView } from './app/views-stats.ts';
import { testsView } from './app/views-tests.ts';
import { $, esc } from './app/ui.ts';

const VIEWS: View[] = [homeView, numbersView, patternsView, testsView];

const state: {
  draws: Draw[];
  period: PeriodResults | null;
  sel: PeriodSel;
  view: string;
  status: string;
  error: string;
} = {
  draws: getDraws(),
  period: null,
  sel: loadPeriodSel(),
  view: VIEWS.some((v) => v.key === location.hash.slice(1)) ? location.hash.slice(1) : 'home',
  status: '',
  error: '',
};

const range = () => resolvePeriod(state.sel, state.draws);
const homeState = (): HomeState => ({ rec: state.period?.recommendation ?? null });

const lastRound = () => state.draws.at(-1)!.round;

$('#app')!.innerHTML = `
  <header class="app-header">
    <div class="app-title">
      <h1>로또 통계</h1>
      <div class="sync"><span id="sync-text"></span><button class="icon-btn" id="btn-sync" aria-label="맥북에서 새 회차 받기">${ICONS.refresh}</button></div>
    </div>
    <div class="period-bar" id="period-bar"></div>
  </header>
  <main id="view"></main>
  <nav class="bottom-nav">${VIEWS.map((v) => `<button data-view="${v.key}">${v.icon}<span>${v.label}</span></button>`).join('')}</nav>`;

// ───────── 렌더링 ─────────

function renderHeader() {
  const synced = lastSyncAt();
  $('#sync-text')!.textContent = state.status || `${lastRound()}회${synced ? ` · ${new Date(synced).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })} 동기화` : ''}`;
  const view = VIEWS.find((v) => v.key === state.view)!;
  const bar = $('#period-bar')!;
  bar.hidden = !view.usesPeriod;
  if (!view.usesPeriod) return;
  const r = range();
  bar.innerHTML = `
    <div class="chips">${PRESETS.map((p) => `<button class="chip ${p.key === state.sel.key ? 'on' : ''}" data-period="${p.key}">${p.label}</button>`).join('')}</div>
    ${state.sel.key === 'custom'
      ? `<form class="custom" id="custom-form"><input inputmode="numeric" name="from" value="${r.from}" aria-label="시작 회차">~<input inputmode="numeric" name="to" value="${r.to}" aria-label="끝 회차">회<button class="btn sm">적용</button></form>`
      : ''}
    <div class="range">${esc(r.label)} · ${r.count.toLocaleString()}회</div>
    ${state.sel.key === 'custom' ? '<div class="range warn">기간을 여러 번 바꿔 볼수록 우연한 "유의"가 늘어납니다</div>' : ''}`;
}

function render() {
  destroyCharts();
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
  renderHeader();
  const view = VIEWS.find((v) => v.key === state.view)!;
  const ctx: ViewCtx = { draws: state.draws, period: state.period, range: range(), home: view.key === 'home' ? homeState() : undefined };
  $('#view')!.innerHTML = (state.error ? `<p class="error">${esc(state.error)}</p>` : '') + view.render(ctx);
  view.after?.(ctx);
  if (view.key === 'home') bindHome();
}

function bindHome() {
  $('#btn-regen')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    try {
      const rec = await reRecommend(state.draws, Math.floor(Math.random() * 2 ** 31), state.period?.recommendation.disabled ?? []);
      $('#picks')!.innerHTML = picksHtml(rec);
      $('#picks-foot')!.textContent = picksFooter(rec);
      $('#odds')!.innerHTML = oddsHtml(rec, thetaOf(state.period));
    } finally {
      btn.disabled = false;
    }
  });
  const box = $('#history');
  if (box) void fetchRecommendationHistory().then((recs) => {
    if ($('#history') === box) box.innerHTML = historyHtml(recs);
  });
  $('#btn-scan')?.addEventListener('click', () => void scanFlow());
  $('#purchases')?.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-del-ticket]');
    if (!b) return;
    if (b.dataset.confirm !== '1') {
      // 실수 방지: 한 번 더 눌러야 삭제
      b.dataset.confirm = '1';
      b.textContent = '한 번 더 누르면 삭제';
      return;
    }
    b.disabled = true;
    flash((await deletePurchase(b.dataset.delTicket!)) ? '용지 삭제됨' : '삭제 실패 (맥북 연결 확인)');
    void loadPurchases();
  });
  void loadPurchases();
}

async function loadPurchases() {
  const box = $('#purchases');
  if (!box) return;
  const list = await fetchPurchases();
  if ($('#purchases') === box) box.innerHTML = purchasesHtml(list, pendingPurchases().length, state.draws);
}

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

/** 확인 시트: 저장(true) / 취소(false) */
function confirmSheet(html: string, ok: string): Promise<boolean> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'sheet-backdrop';
    el.innerHTML = `<div class="sheet">${html}<div class="actions"><button class="btn" data-v="0">취소</button><button class="btn primary" data-v="1">${ok}</button></div></div>`;
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-v]');
      if (!b && e.target !== el) return;
      el.remove();
      resolve(b?.dataset.v === '1');
    });
    document.body.append(el);
  });
}

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
  const r = await savePurchaseQr(qr);
  flash(
    r.status === 'saved' ? `${ticket.round}회 ${ticket.games.length}게임 저장` :
    r.status === 'duplicate' ? '이미 저장된 용지' :
    r.status === 'queued' ? '맥북 연결 안 됨 — 기기에 보관, 연결되면 전송' : 'error' in r ? r.error : '',
  );
  void loadPurchases();
}

// ───────── 계산 ─────────

let periodToken = 0;

async function ensurePeriod() {
  const r = range();
  state.period = cachedPeriod(lastRound(), r.from, r.to);
  if (state.period) return render();
  const token = ++periodToken;
  render();
  try {
    const res = await computePeriod(state.draws, r.from, r.to);
    if (token !== periodToken) return; // 그 사이 기간이 바뀜 → 버림
    state.period = res;
  } catch (e) {
    state.error = `계산 오류: ${(e as Error).message}`;
  }
  render();
}

async function sync(force: boolean) {
  const btn = $<HTMLButtonElement>('#btn-sync')!;
  btn.disabled = true;
  btn.classList.add('spin');
  state.status = '확인 중…';
  renderHeader();
  const sent = await flushPendingPurchases();
  if (sent && state.view === 'home') void loadPurchases();
  const r = await syncDraws(state.draws, force);
  btn.disabled = false;
  btn.classList.remove('spin');
  if (r.status === 'updated') {
    state.draws = getDraws();
    state.status = `+${r.added.join(', ')}회`;
    state.period = null;
    await ensurePeriod();
  } else {
    state.status = r.status === 'failed' ? '맥북 연결 안 됨' : r.status === 'skipped' ? '잠시 후 재시도' : force ? '최신' : '';
    renderHeader();
  }
  setTimeout(() => {
    state.status = '';
    renderHeader();
  }, 4000);
}

// ───────── 이벤트 ─────────

document.querySelector('.bottom-nav')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-view]');
  if (!b || b.dataset.view === state.view) return;
  state.view = b.dataset.view!;
  history.replaceState(null, '', `#${state.view}`);
  window.scrollTo({ top: 0 });
  render();
});

$('#period-bar')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-period]');
  if (!b) return;
  const key = b.dataset.period as PeriodSel['key'];
  if (key === state.sel.key && key !== 'custom') return;
  const r = range();
  state.sel = key === 'custom' ? { key, from: r.from, to: r.to } : { key };
  savePeriodSel(state.sel);
  void ensurePeriod();
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
  if (r.count === MIN_DRAWS && Math.abs(to - from) + 1 < MIN_DRAWS) state.status = `최소 ${MIN_DRAWS}회로 조정`;
  void ensurePeriod();
});

$('#btn-sync')!.addEventListener('click', () => void sync(true));

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => render());

// ───────── 시작 ─────────

(async () => {
  await ensurePeriod();
  await sync(false);
})();
