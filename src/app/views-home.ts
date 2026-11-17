/** 홈(이번 주): 최신 당첨번호 · 이번 주 추천과 당첨 확률 · 이번 주 구매(QR 스캔) */
import type { RecommendResult } from '../recommend/recommend.ts';
import { MODE_LABEL, type Ticket } from '../data/qr.ts';
import { RULES } from '../recommend/rules.ts';
import { firstPrizeOverYears, perGameOdds } from '../recommend/odds.ts';
import { recStrategy, unclaimedLine } from './views-buy.ts';
import { ICONS, type View } from './view.ts';
import { balls, card, eok, loading, pct, won } from './ui.ts';
import type { StoredPurchase } from '../db/repository.ts';

const inv = (p: number) => `1/${Math.round(1 / p).toLocaleString()}`;

/** 묶음 구성 설명: 7게임까지는 번호가 전혀 안 겹치고, 그 이상은 게임끼리 겹침 1개 이하 */
const layout = (g: number) => (g * 6 <= 45 ? `${g * 6}개 번호 서로 다름` : `${g}게임 · 서로 겹침 1개 이하`);

/** 용지 한 장 = 5게임 */
const PER_TICKET = 5;
const LETTERS = 'ABCDE';

/** 추천을 용지 단위(5게임)로 묶어 A~E 표시 — 판매점에서 그대로 옮겨 적기 쉽게 */
export function picksHtml(rec: RecommendResult, size: 'sm' | '' = 'sm'): string {
  const tickets = Math.ceil(rec.picks.length / PER_TICKET);
  return Array.from({ length: tickets }, (_, t) => {
    const rows = rec.picks.slice(t * PER_TICKET, (t + 1) * PER_TICKET).map((p, i) => {
      const f = rec.fixed.find((n) => p.numbers.includes(n));
      return `<div class="pick"><span class="slot">${LETTERS[i]}</span>${markHot(balls(p.numbers, undefined, size), rec.hot)}${f ? `<span class="muted small">고정 ${f}</span>` : ''}</div>`;
    });
    return `<div class="ticket">${tickets > 1 ? `<div class="ticket-head">용지 ${t + 1}</div>` : ''}${rows.join('')}</div>`;
  }).join('');
}

/** 핫 번호 공에 표시 */
function markHot(html: string, hot: readonly number[]): string {
  if (!hot.length) return html;
  return html.replace(/<span class="ball ([^"]*)">(\d+)<\/span>/g, (m, cls, n) => (hot.includes(Number(n)) ? `<span class="ball ${cls} hot">${n}</span>` : m));
}

/** 복사용 텍스트 (메모·메신저에 붙여 넣기) */
export function picksText(rec: RecommendResult): string {
  const lines = [`${rec.targetRound}회 ${rec.strategy === 'hot' ? '핫 번호' : '기본'} 추천 ${rec.picks.length}게임`];
  rec.picks.forEach((p, i) => {
    if (i % PER_TICKET === 0 && rec.picks.length > PER_TICKET) lines.push(`[용지 ${i / PER_TICKET + 1}]`);
    lines.push(`${LETTERS[i % PER_TICKET]}  ${p.numbers.map((n) => String(n).padStart(2, '0')).join(' ')}`);
  });
  return lines.join('\n');
}

/** 용지 보기 시트: 큰 공으로 용지 모양 그대로 */
export function ticketSheetHtml(rec: RecommendResult): string {
  return `<h2>${rec.targetRound}회 추천 · 용지 ${Math.ceil(rec.picks.length / PER_TICKET)}장</h2><div class="sheet-picks">${picksHtml(rec, '')}</div>`;
}

export function picksFooter(rec: RecommendResult): string {
  return `${rec.strategy === 'hot' ? '핫 2개씩 · ' : ''}${rec.picks.length * 6 <= 45 && rec.strategy !== 'hot' ? '번호 안 겹침' : '겹침 ≤1'}${rec.popularity ? ` · 비인기 ×${rec.popularity.average.toFixed(2)}` : ''}`;
}

/** 감시 경고로 해제된 규칙이 있으면 경고, 아니면 규칙 개수 */
export function strengthBadge(rec: RecommendResult): string {
  // 평소에는 표시하지 않고, 감시 경고로 규칙이 해제됐을 때만
  return rec.disabled.length
    ? `<span class="badge warn" title="${rec.disabled.map((k) => RULES.find((r) => r.key === k)?.name).join(', ')}">규칙 ${rec.disabled.length}개 해제</span>`
    : '';
}

/** 당첨 확률 — 목표(3·4등) 기준 */
export function oddsHtml(rec: RecommendResult): string {
  const o = rec.setOdds;
  const g = rec.picks.length;
  if (!o || g === 0) return '';
  const per = perGameOdds();
  const p4 = per[0].probability + per[1].probability + per[2].probability + per[3].probability;
  return `<div class="odds-hero"><span class="odds-label">이번 주 4등 이상</span><span class="odds-value">${pct(o.atLeast4, 2)}</span><span class="muted small">${inv(o.atLeast4)}</span></div>
    <p class="line odds-sub">3등 이상 ${inv(o.atLeast5)} · 아무 등수 ${pct(o.anyPrize, 1)} · 1년 안 4등 이상 ${pct(1 - (1 - o.atLeast4) ** 52, 0)}</p>
    <details class="theory"><summary>확률 상세</summary><div class="body">
      <div class="table-wrap"><table><thead><tr><th>등수 (게임당, 모든 조합 같음)</th><th class="num">확률</th></tr></thead><tbody>${per
        .map((p) => `<tr><td>${p.rank}등 (${p.label})</td><td class="num">${inv(p.probability)}</td></tr>`)
        .join('')}<tr><td>4등 이상</td><td class="num">${inv(p4)}</td></tr></tbody></table></div>
      <p>${g}게임은 당첨번호 8,145,060가지를 전부 대입한 정확값입니다. ${g * 6 <= 45 ? '게임끼리 번호가 하나도 겹치지 않아' : '어느 두 게임도 겹치는 번호가 1개 이하라 두 게임이 동시에 4개 이상 맞을 수 없어'} 4등·3등 이상 확률이 ${g}게임으로 낼 수 있는 최대입니다. 매주 ${g}게임이면 1년 안에 4등 이상 ${pct(1 - (1 - o.atLeast4) ** 52, 0)}, 10년 안에 1등 ${pct(firstPrizeOverYears(g, 10), 2)}.</p>
      ${rec.popularity ? `<p>비인기 우선: 확률이 같은 후보 중 구매자가 덜 고르는 조합을 골랐습니다. 인기도 ×${rec.popularity.average.toFixed(2)} = 평균 조합 대비 공동 당첨자 수 추정(5등 당첨자 수로 추정, 1~3등 효과는 미확인). 당첨 확률에는 영향이 없습니다.</p>` : ''}
      <p>제외 규칙 ${RULES.length - rec.disabled.length}개: ${RULES.filter((r) => !rec.disabled.includes(r.key)).map((r) => r.name).join(' · ')} — 확률은 바꾸지 않습니다 (검정 탭 "추천 규칙 감시").</p>
    </div></details>`;
}

/** 스캔한 용지 확인 화면 */
export function ticketPreviewHtml(t: Ticket, nextRound: number): string {
  const when = t.round === nextRound ? '이번 회차' : t.round < nextRound ? '지난 회차' : '다음 회차 이후';
  return `<h2>${t.round}회 <span class="muted small">${when} · ${t.games.length}게임</span></h2>
    ${t.games.map((g) => `<div class="pick">${balls(g.numbers, undefined, 'sm')}<span class="muted small">${'ABCDE'[g.slot]} ${MODE_LABEL[g.mode]}</span></div>`).join('')}`;
}

/** 직접 입력 시트 (QR이 안 읽힐 때) */
export function entryFormHtml(nextRound: number): string {
  const row = (i: number) =>
    `<div class="entry-row"><span class="muted small">${'ABCDE'[i]}</span>${Array.from({ length: 6 }, () => '<input inputmode="numeric" maxlength="2">').join('')}</div>`;
  return `<h2>직접 입력</h2>
    <label class="entry-round">회차 <input inputmode="numeric" name="round" value="${nextRound}"></label>
    ${[0, 1, 2, 3, 4].map(row).join('')}
    <p class="muted small">빈 줄은 건너뜁니다. 번호는 1~45, 한 줄에 서로 다른 6개.</p>`;
}

/** 고정 번호 시트 */
export function fixedFormHtml(current: number[]): string {
  return `<h2>고정 번호</h2>
    <p class="muted small">좋아하는 번호를 최대 5개까지 고르면 앞 게임부터 하나씩 넣고 나머지는 규칙대로 채웁니다. 게임끼리 겹치는 조건은 그대로라 당첨 확률은 같습니다.</p>
    <div class="num-grid">${Array.from({ length: 45 }, (_, i) => i + 1)
      .map((n) => `<button type="button" class="num-pick ${current.includes(n) ? 'on' : ''}" data-num="${n}">${n}</button>`)
      .join('')}</div>`;
}

/** 이번 주 산 게임이 어느 방식 추천인지 요약 */
function buyMix(mine: StoredPurchase[], which: (p: StoredPurchase) => 'default' | 'hot' | null): string {
  const d = mine.filter((p) => which(p) === 'default').length;
  const h = mine.filter((p) => which(p) === 'hot').length;
  const o = mine.length - d - h;
  return [d && `기본 ${d}`, h && `핫 ${h}`, o && `직접 ${o}`].filter(Boolean).map((x) => ` · ${x}`).join('');
}

/** 최신 회차에 산 용지의 결과 한 줄 */
function myResult(list: StoredPurchase[] | null | undefined, round: number): string {
  const mine = (list ?? []).filter((p) => p.targetRound === round);
  if (!mine.length) return '';
  if (mine[0].matched === null) return '<p class="line my-result">내 결과: 채점 중…</p>';
  const wins = mine.filter((p) => (p.prizeRank ?? 0) > 0);
  if (!wins.length) return `<p class="line my-result">내 결과: ${mine.length}게임 낙첨 · 최다 ${Math.max(...mine.map((p) => p.matched ?? 0))}개 일치</p>`;
  const by = [1, 2, 3, 4, 5].map((r) => [r, wins.filter((p) => p.prizeRank === r).length] as const).filter(([, n]) => n);
  return `<p class="line my-result win">내 결과: ${by.map(([r, n]) => `${r}등 ${n}게임`).join(' · ')} · ${won(wins.reduce((a, p) => a + (p.prizeAmount ?? 0), 0))}</p>`;
}

export const homeView: View = {
  key: 'home',
  label: '홈',
  icon: ICONS.home,
  usesPeriod: false,
  inNav: true,
  render: (c) => {
    const last = c.draws.at(-1)!;
    const next = last.round + 1;
    const p1 = last.prizes[0];
    const list = c.server.purchases;
    const latest = card(
      `${last.round}회 당첨번호 <span class="muted">${last.date.slice(5).replace('-', '.')}</span>`,
      balls(last.numbers, last.bonus) + (p1.winners ? `<p class="line">1등 <b>${p1.winners}명</b> · 1인 <b>${eok(p1.amount)}</b></p>` : '') + myResult(list, last.round),
    );

    // 이번 주 구매 상태 + 스캔 (토요일에 가장 많이 쓰는 동작 → 위로)
    const mine = list?.filter((p) => p.targetRound === next) ?? [];
    const which = recStrategy(c.server.recs);
    const status =
      list === undefined ? '<p class="muted small">구매 기록 확인 중…</p>'
      : list === null ? '<p class="muted small">맥북 연결 안 됨 — 스캔하면 휴대폰에 보관했다가 나중에 보냅니다</p>'
      : mine.length ? `<p class="line"><b>${mine.length}게임 구매함</b>${buyMix(mine, which)}</p>`
      : '<p class="line">아직 구매 기록 없음</p>';
    const pending = c.server.pending ? `<p class="line warn-text">맥북에 못 보낸 용지 ${c.server.pending}장</p>` : '';
    const buy = card(
      `${next}회 구매`,
      `${status}${pending}${unclaimedLine(list, c.draws)}
       <div class="scan-row"><button class="btn primary big" data-scan>QR 스캔</button><button class="btn" data-entry>직접 입력</button></div>`,
      { cls: 'hero' },
    );

    const rec = c.rec;
    const picks = card(
      `${next}회 추천`,
      !rec
        ? loading('추천 계산 중…')
        : `<div class="seg mini">${(['default', 'hot'] as const).map((s) => `<button class="${c.strategy === s ? 'on' : ''}" data-strategy="${s}">${s === 'hot' ? '핫 번호' : '기본 (비인기 우선)'}</button>`).join('')}</div>
           ${rec.strategy === 'hot' ? `<p class="line">최근 50회 핫 번호 · 게임마다 2개씩 <span class="balls hot-list">${markHot(balls(rec.hot, undefined, 'xs'), rec.hot)}</span></p>` : ''}
           <div id="odds">${oddsHtml(rec)}</div>
           <div id="picks">${picksHtml(rec)}</div>
           <div class="row between"><span class="muted small">${picksFooter(rec)}</span>
             <span class="row tight">${rec.strategy === 'hot' ? '' : `<button class="btn sm" id="btn-fixed">${rec.fixed.length ? `고정 ${rec.fixed.join('·')}` : '번호 고정'}</button>`}<button class="btn sm" id="btn-regen">다른 조합</button></span></div>`,
      { badge: rec ? `<span class="row tight">${strengthBadge(rec)}<button class="btn sm" id="btn-sheet">용지 보기</button></span>` : '' },
    );
    return latest + buy + picks;
  },
};
