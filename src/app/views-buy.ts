/** 내 구매: 성적표 · 누적 손익 · 건너뛴 회차 · 연간 리포트 · 회차별 용지(수령) · 추천 기록 · 내보내기 */
import type { StoredPurchase, StoredRecommendation } from '../db/repository.ts';
import type { Draw } from '../data/types.ts';
import { MODE_LABEL } from '../data/qr.ts';
import { API_BASE } from '../data/api.ts';
import { perGameOdds } from '../recommend/odds.ts';
import { css, line, mount } from './charts.ts';
import { netPrize } from './tax.ts';
import { ICONS, type View } from './view.ts';
import { $, balls, card, esc, fx, loading, pct, tile, won } from './ui.ts';

const DAY = 86_400_000;

/** 당첨금 받는 곳 (등수별) */
export const CLAIM_PLACE: Record<number, string> = {
  1: 'NH농협은행 본점',
  2: 'NH농협은행 지점',
  3: 'NH농협은행 지점',
  4: '복권 판매점',
  5: '복권 판매점',
};

/** 지급 기한: 추첨 다음 날(지급 개시)부터 1년. 마지막 날이 휴일이면 다음 영업일 — 정확한 날은 용지 뒷면 */
export function claimDeadline(drawDate: string): Date {
  const d = new Date(`${drawDate}T00:00:00+09:00`);
  d.setFullYear(d.getFullYear() + 1);
  return new Date(d.getTime() + DAY);
}

/** 받지 않은 당첨 (기한 임박 순) */
export function unclaimedWins(list: StoredPurchase[] | null | undefined, draws: readonly Draw[], now = new Date()) {
  if (!list) return [];
  const dates = new Map(draws.map((d) => [d.round, d.date]));
  return list
    .filter((p) => (p.prizeRank ?? 0) > 0 && !p.claimedAt && dates.has(p.targetRound))
    .map((p) => {
      const deadline = claimDeadline(dates.get(p.targetRound)!);
      return { p, deadline, daysLeft: Math.ceil((deadline.getTime() - now.getTime()) / DAY) };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/** 회차별 누적 구매액·당첨금·이론 기대 (추첨된 회차만) — 차트용 */
export function cumulativeSeries(list: StoredPurchase[], draws: readonly Draw[]) {
  const per = perGameOdds();
  const drawMap = new Map(draws.map((d) => [d.round, d]));
  const rounds = [...new Set(list.filter((p) => p.matched !== null).map((p) => p.targetRound))].sort((a, b) => a - b);
  let spent = 0;
  let won_ = 0;
  let expected = 0;
  const out = { labels: [] as number[], spent: [] as number[], won: [] as number[], expected: [] as number[] };
  for (const r of rounds) {
    const games = list.filter((p) => p.targetRound === r);
    const d = drawMap.get(r);
    spent += games.length * 1000;
    won_ += games.reduce((a, p) => a + (p.prizeAmount ?? 0), 0);
    // 이 회차 실제 1인 당첨금으로 계산한 게임당 기대 당첨금 Σ P(등수)·당첨금
    if (d) expected += games.length * d.prizes.reduce((a, pr, i) => a + per[i].probability * pr.amount, 0);
    out.labels.push(r);
    out.spent.push(spent);
    out.won.push(won_);
    out.expected.push(Math.round(expected));
  }
  return out;
}

/** 첫 구매 회차부터 최신 추첨 회차까지 용지가 없는 회차 */
export function skippedRounds(list: StoredPurchase[], lastDrawn: number): number[] {
  const bought = new Set(list.map((p) => p.targetRound));
  if (bought.size === 0) return [];
  const first = Math.min(...bought);
  const out: number[] = [];
  for (let r = first; r <= lastDrawn; r++) if (!bought.has(r)) out.push(r);
  return out;
}

/** 연도별 구매·당첨 (추첨일 기준) */
export function annualReport(list: StoredPurchase[], draws: readonly Draw[]) {
  const year = new Map(draws.map((d) => [d.round, d.date.slice(0, 4)]));
  const rows = new Map<string, { year: string; games: number; graded: number; won: number; best: number }>();
  for (const p of list) {
    const y = year.get(p.targetRound) ?? '추첨 전';
    const r = rows.get(y) ?? { year: y, games: 0, graded: 0, won: 0, best: 0 };
    r.games++;
    if (p.matched !== null) {
      r.graded++;
      r.won += p.prizeAmount ?? 0;
      if (p.prizeRank && (!r.best || p.prizeRank < r.best)) r.best = p.prizeRank;
    }
    rows.set(y, r);
  }
  return [...rows.values()].sort((a, b) => b.year.localeCompare(a.year));
}

/** 성적표: 등수별 실제 게임 수 vs 이론 기대 */
function scorecard(graded: { prizeRank: number | null }[]): string {
  const per = perGameOdds();
  return [5, 4, 3, 2, 1]
    .map((rank) => {
      const hit = graded.filter((r) => r.prizeRank === rank).length;
      const exp = graded.length * per[rank - 1].probability;
      return `<tr><td>${rank}등</td><td class="num">${hit}</td><td class="num">${fx(exp, exp < 0.1 ? 4 : 2)}</td></tr>`;
    })
    .join('');
}

/** 맞힌 번호만 진하게 */
export function ballsHit(nums: readonly number[], win: ReadonlySet<number> | null): string {
  const html = balls(nums, undefined, 'sm');
  if (!win) return html;
  return html.replace(/<span class="ball ([^"]*)">(\d+)<\/span>/g, (m, cls, n) => (win.has(Number(n)) ? m : `<span class="ball ${cls} miss">${n}</span>`));
}

const key6 = (n: readonly number[]) => [...n].sort((a, b) => a - b).join(',');

/** 이 게임이 그 회차 어느 방식 추천과 같은지 (기본 / 핫 번호 / 직접 고름 = null) */
export function recStrategy(recs: StoredRecommendation[] | null | undefined) {
  const m = new Map<string, 'default' | 'hot'>();
  for (const r of recs ?? []) m.set(`${r.targetRound}:${key6(r.numbers)}`, r.strategy ?? 'default');
  return (p: { targetRound: number; numbers: readonly number[] }) => m.get(`${p.targetRound}:${key6(p.numbers)}`) ?? null;
}

/** 이 게임이 추천(어느 방식이든) 그대로인지 */
export function recMatcher(recs: StoredRecommendation[] | null | undefined) {
  const which = recStrategy(recs);
  return (p: { targetRound: number; numbers: readonly number[] }) => which(p) !== null;
}

export const STRATEGY_LABEL = { default: '기본', hot: '핫' } as const;

/**
 * 방식 비교: 맥북이 매주 기록한 두 방식 추천을 (실제로 샀는지와 무관하게) 채점한 결과
 * 회차 기준 — 그 회차 10게임 중 하나라도 n등 이상이면 1회
 */
export function strategyCompare(recs: StoredRecommendation[] | null | undefined) {
  const out = (['default', 'hot'] as const).map((st) => {
    const rs = (recs ?? []).filter((r) => (r.strategy ?? 'default') === st && r.matched !== null);
    const byRound = new Map<number, StoredRecommendation[]>();
    for (const r of rs) byRound.set(r.targetRound, [...(byRound.get(r.targetRound) ?? []), r]);
    const rounds = [...byRound.values()];
    const best = rounds.map((g) => Math.min(...g.map((r) => r.prizeRank || 9)));
    return {
      strategy: st,
      rounds: rounds.length,
      games: rs.length,
      rank: [1, 2, 3, 4, 5].map((k) => rs.filter((r) => r.prizeRank === k).length),
      any: best.filter((b) => b < 9).length,
      atLeast4: best.filter((b) => b <= 4).length,
    };
  });
  return out;
}

function compareHtml(recs: StoredRecommendation[] | null | undefined): string {
  const [d, h] = strategyCompare(recs);
  if (!d.rounds && !h.rounds) return '<p class="muted small">추첨이 끝난 기록이 쌓이면 표시됩니다 (맥북이 매주 두 방식을 모두 기록·채점).</p>';
  const per = perGameOdds();
  const row = (label: string, a: number, b: number, e: string) => `<tr><td>${label}</td><td class="num">${a}</td><td class="num">${b}</td><td class="num">${e}</td></tr>`;
  const g = Math.max(d.games, h.games);
  return `<div class="table-wrap"><table><thead><tr><th>${Math.max(d.rounds, h.rounds)}회</th><th class="num">기본</th><th class="num">핫</th><th class="num">이론</th></tr></thead><tbody>
    ${row('5등 (게임)', d.rank[4], h.rank[4], fx(g * per[4].probability, 1))}
    ${row('4등 (게임)', d.rank[3], h.rank[3], fx(g * per[3].probability, 2))}
    ${row('3등 이상 (게임)', d.rank[0] + d.rank[1] + d.rank[2], h.rank[0] + h.rank[1] + h.rank[2], fx(g * (per[0].probability + per[1].probability + per[2].probability), 3))}
    ${row('당첨 회차', d.any, h.any, fx(Math.max(d.rounds, h.rounds) * 0.23, 1))}
    </tbody></table></div><p class="line muted">실제로 산 것과 상관없이 두 방식 추천을 가상으로 채점합니다. 당첨 확률은 같아서 길게 보면 비슷해야 정상입니다.</p>`;
}

/** 받지 않은 당첨 경고 한 줄 (홈·내 구매 공통) */
export function unclaimedLine(list: StoredPurchase[] | null | undefined, draws: readonly Draw[]): string {
  const u = unclaimedWins(list, draws);
  if (!u.length) return '';
  const sum = u.reduce((a, x) => a + (x.p.prizeAmount ?? 0), 0);
  return `<p class="line ${u[0].daysLeft <= 30 ? 'warn-text' : ''}">받지 않은 당첨금 ${u.length}건 · ${won(sum)} — 가장 가까운 기한 ${u[0].daysLeft}일 남음</p>`;
}

function roundsHtml(list: StoredPurchase[], draws: readonly Draw[], which: (p: StoredPurchase) => 'default' | 'hot' | null): string {
  const isRec = (p: StoredPurchase) => which(p) !== null;
  const drawMap = new Map(draws.map((d) => [d.round, d]));
  const byRound = new Map<number, StoredPurchase[]>();
  for (const p of list) byRound.set(p.targetRound, [...(byRound.get(p.targetRound) ?? []), p]);
  return [...byRound.entries()]
    .map(([round, ps], idx) => {
      const d = drawMap.get(round);
      const win = d ? new Set(d.numbers) : null;
      const graded = ps[0].matched !== null;
      const prize = ps.reduce((a, p) => a + (p.prizeAmount ?? 0), 0);
      const best = graded ? Math.min(...ps.map((p) => p.prizeRank || 9)) : 9;
      const recCount = ps.filter(isRec).length;
      const summary = !graded ? '추첨 전' : best === 9 ? '낙첨' : `${best}등 · ${won(prize)}`;
      const game = (p: StoredPurchase) => {
        const claim =
          (p.prizeRank ?? 0) > 0 && d
            ? `<div class="claim"><span>${CLAIM_PLACE[p.prizeRank!]} · 기한 ${claimDeadline(d.date).toLocaleDateString('ko-KR')}${
                p.prizeAmount && netPrize(p.prizeAmount) !== p.prizeAmount ? ` · 실수령 ${won(netPrize(p.prizeAmount))}` : ''
              }</span><button class="btn sm" data-claim="${esc(p.ticketKey)}" data-slot="${p.slot}" data-claimed="${p.claimedAt ? '1' : '0'}">${p.claimedAt ? '✓ 받음' : '받았음 표시'}</button></div>`
            : '';
        return `<div class="pick">${ballsHit(p.numbers, win)}<span class="muted small">${which(p) ? `<b class="tag">${STRATEGY_LABEL[which(p)!]}</b> ` : ''}${MODE_LABEL[p.mode]}${
          p.matched !== null ? ` · ${p.matched}개${p.prizeRank ? ` <b>${p.prizeRank}등</b>` : ''}` : ''
        }</span></div>${claim}`;
      };
      const tickets = [...new Set(ps.map((p) => p.ticketKey))].map((k) => ps.filter((p) => p.ticketKey === k).sort((a, b) => a.slot - b.slot));
      // 가장 최근 회차는 펼쳐서
      return `<details class="buy"${idx === 0 ? ' open' : ''}><summary class="hist-row"><span class="hist-round">${round}회</span><span class="muted small">${ps.length}게임${recCount ? ` · 추천 ${recCount}` : ''}</span><span class="hist-sum ${best < 9 ? 'win' : ''}">${summary}</span></summary>
        ${tickets.map((g) => `${g.map(game).join('')}<div class="row end"><button class="btn sm" data-del-ticket="${esc(g[0].ticketKey)}">이 용지 삭제</button></div>`).join('')}
      </details>`;
    })
    .join('');
}

/** 맥북에 기록된 회차별 기본 추천 결과 */
export function historyHtml(recs: StoredRecommendation[] | null | undefined): string {
  if (recs === undefined) return '<p class="muted small">불러오는 중…</p>';
  if (recs === null) return '<p class="muted small">맥북 연결 안 됨</p>';
  if (recs.length === 0) return '<p class="muted small">기록 없음</p>';
  const byRound = new Map<number, StoredRecommendation[]>();
  for (const r of recs) byRound.set(r.targetRound, [...(byRound.get(r.targetRound) ?? []), r]);
  const sum = (list: StoredRecommendation[]) => {
    if (!list.length) return '–';
    if (list[0].matched === null) return '추첨 전';
    const best = Math.min(...list.map((r) => r.prizeRank || 9));
    return best === 9 ? `낙첨(최다 ${Math.max(...list.map((r) => r.matched ?? 0))}개)` : `<b class="win-text">${best}등</b>`;
  };
  return [...byRound.entries()]
    .map(([round, list]) => {
      const d = list.filter((r) => (r.strategy ?? 'default') === 'default');
      const h = list.filter((r) => r.strategy === 'hot');
      return `<div class="hist-row"><span class="hist-round">${round}회</span><span class="hist-sum">기본 ${sum(d)} · 핫 ${sum(h)}</span></div>`;
    })
    .join('');
}

export const buyView: View = {
  key: 'buy',
  label: '내 구매',
  icon: ICONS.buy,
  usesPeriod: false,
  inNav: true,
  render: (c) => {
    const { purchases: list, recs, pending } = c.server;
    const queued = pending ? `<p class="line warn-text">맥북에 아직 못 보낸 용지 ${pending}장 — 연결되면 자동 전송</p>` : '';
    const actions = '<div class="row tight"><button class="btn sm" data-entry>직접 입력</button><button class="btn sm primary" data-scan>QR 스캔</button></div>';
    if (list === undefined) return card('내 구매', loading('불러오는 중…'), { badge: actions });
    if (list === null) return card('내 구매', queued + '<p class="muted small">맥북 연결 안 됨 — Tailscale을 켜고 새로고침</p>', { badge: actions }) + extras(recs);
    if (list.length === 0) return card('내 구매', queued + '<p class="muted small">구매 기록 없음 — 용지 QR을 스캔하세요</p>', { badge: actions }) + extras(recs);

    const which = recStrategy(recs);
    const graded = list.filter((p) => p.matched !== null);
    const wonSum = graded.reduce((a, p) => a + (p.prizeAmount ?? 0), 0);
    const netSum = graded.reduce((a, p) => a + netPrize(p.prizeAmount ?? 0), 0);
    const defG = graded.filter((p) => which(p) === 'default');
    const hotG = graded.filter((p) => which(p) === 'hot');
    const ownG = graded.filter((p) => which(p) === null);
    const wins = (xs: StoredPurchase[]) => xs.filter((p) => (p.prizeRank ?? 0) > 0).length;
    const lastDrawn = c.draws.at(-1)!.round;
    const skipped = skippedRounds(list, lastDrawn);
    const rounds = new Set(list.map((p) => p.targetRound)).size;

    const summary = card(
      '내 구매',
      `${queued}${unclaimedLine(list, c.draws)}
       <div class="tiles">
         ${tile('구매', won(list.length * 1000), `${list.length}게임 · ${rounds}회`)}
         ${tile('당첨금', won(wonSum), graded.length ? `회수율 ${pct(wonSum / (graded.length * 1000), 0)}${netSum !== wonSum ? ` · 실수령 ${won(netSum)}` : ''}` : '추첨 전')}
       </div>
       ${skipped.length ? `<p class="line muted">건너뛴 회차 ${skipped.length}회: ${skipped.slice(-8).join(', ')}${skipped.length > 8 ? ' …' : ''}</p>` : ''}`,
      { badge: actions },
    );

    const score = graded.length
      ? card(
          '성적표',
          `<div class="table-wrap"><table><thead><tr><th>추첨된 ${graded.length}게임</th><th class="num">실제</th><th class="num">이론 기대</th></tr></thead><tbody>${scorecard(graded)}</tbody></table></div>
           ${recs ? `<p class="line muted">기본 ${defG.length}게임 중 당첨 ${wins(defG)} · 핫 ${hotG.length}게임 중 당첨 ${wins(hotG)} · 직접 ${ownG.length}게임 중 당첨 ${wins(ownG)} (게임당 5등 이상 2.4%)</p>` : ''}
           ${new Set(graded.map((p) => p.targetRound)).size >= 2 ? '<div class="chart short" id="c-pnl" role="img" aria-label="누적 구매액·당첨금·이론 기대"></div>' : ''}`,
        )
      : '';

    const years = annualReport(list, c.draws);
    const annual =
      years.length > 1 || (years[0] && years[0].year !== '추첨 전')
        ? card(
            '연간',
            `<div class="table-wrap"><table><thead><tr><th>연도</th><th class="num">구매</th><th class="num">당첨금</th><th class="num">회수율</th><th class="num">최고</th></tr></thead><tbody>${years
              .map((y) => `<tr><td>${y.year}</td><td class="num">${won(y.games * 1000)}</td><td class="num">${won(y.won)}</td><td class="num">${y.graded ? pct(y.won / (y.graded * 1000), 0) : '–'}</td><td class="num">${y.best ? `${y.best}등` : '–'}</td></tr>`)
              .join('')}</tbody></table></div>`,
          )
        : '';

    const tickets = card('회차별 용지', roundsHtml(list, c.draws, which));
    return summary + score + annual + tickets + extras(recs);
  },
  after: (c) => {
    const el = $('#c-pnl');
    const list = c.server.purchases;
    if (!el || !list) return;
    const s = cumulativeSeries(list, c.draws);
    mount(el, 'line', s.labels, [
      line('당첨금', s.won, css('--s3')),
      line('구매액', s.spent, css('--s2')),
      line('이론 기대', s.expected, css('--muted'), { borderDash: [4, 4] }),
    ], { format: (v) => won(v) });
  },
};

/** 추천 기록 + 내보내기 (구매 기록이 없어도 표시) */
function extras(recs: StoredRecommendation[] | null | undefined): string {
  const base = API_BASE;
  return `${recs ? card('방식 비교 · 기본 vs 핫 번호', compareHtml(recs)) : ''}<details class="section" data-section="recs"><summary><span class="s-title">추천 기록 (맥북이 매주 저장한 기본·핫 추천)</span></summary><div class="s-body">${historyHtml(recs)}</div></details>
    <div class="row export"><a class="btn sm" href="${base}/export/purchases.csv">구매 기록 CSV</a><a class="btn sm" href="${base}/export/draws.csv">당첨번호 CSV</a></div>`;
}
