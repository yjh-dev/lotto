/** 홈: 최신 당첨번호 · 이번 주 추천 · 당첨 확률 · 내 구매(용지 QR) · 지난 추천 */
import type { RecommendResult } from '../recommend/recommend.ts';
import type { StoredPurchase, StoredRecommendation } from '../db/repository.ts';
import type { Draw } from '../data/types.ts';
import { MODE_LABEL, type Ticket } from '../data/qr.ts';
import { RULES } from '../recommend/rules.ts';
import { ICONS, type View } from './view.ts';
import type { PeriodResults } from './results.ts';
import { balls, card, eok, esc, fx, loading, pct, tile, won } from './ui.ts';
import { bayesRatio, firstPrizeOverYears, perGameOdds } from '../recommend/odds.ts';

const inv = (p: number) => `1/${Math.round(1 / p).toLocaleString()}`;

/** main.ts가 정해서 넘겨주는 홈 상태 ("다른 조합"으로 바꾼 추천 포함) */
export interface HomeState {
  rec: RecommendResult | null;
}

/** 사후평균 θ (index 1~45) — 베이지안 참고값 계산용 */
export const thetaOf = (period: PeriodResults | null): number[] | null =>
  period ? [0, ...period.analysis.bayes.posterior.map((p) => p.mean)] : null;

export function picksHtml(rec: RecommendResult): string {
  return rec.picks.map((p) => `<div class="pick">${balls(p.numbers, undefined, 'sm')}</div>`).join('');
}

export function picksFooter(rec: RecommendResult): string {
  return `30개 번호 서로 다름 · 규칙 통과 후보 ${pct(rec.eligibleShare, 0)}`;
}

/** 감시 경고로 해제된 규칙이 있으면 경고, 아니면 규칙 개수 */
export function strengthBadge(rec: RecommendResult): string {
  return rec.disabled.length
    ? `<span class="badge warn" title="${rec.disabled.map((k) => RULES.find((r) => r.key === k)?.name).join(', ')}">규칙 ${rec.disabled.length}개 해제</span>`
    : `<span class="badge plain">규칙 ${RULES.length}개</span>`;
}

/** 당첨 확률 — 목표(3·4등) 기준으로 먼저 보여줌 */
export function oddsHtml(rec: RecommendResult, theta: number[] | null): string {
  const o = rec.setOdds;
  const g = rec.picks.length;
  if (!o || g === 0) return '';
  const per = perGameOdds();
  const p4 = per[0].probability + per[1].probability + per[2].probability + per[3].probability;
  const p3 = per[0].probability + per[1].probability + per[2].probability;
  const anyPer = p4 + per[4].probability;
  const ratios = theta ? rec.picks.map((p) => bayesRatio(theta, p.numbers)) : null;
  return `<div class="tiles">
      ${tile(`4등 이상 · ${g}게임`, pct(o.atLeast4, 2), `${inv(o.atLeast4)} · 이론 최대 ${pct(g * p4, 2)}`)}
      ${tile(`3등 이상 · ${g}게임`, inv(o.atLeast5), `게임당 ${inv(p3)}`)}
      ${tile(`당첨 · ${g}게임`, pct(o.anyPrize, 1), '5등 이상')}
    </div>
    <details class="theory"><summary>확률 상세</summary><div class="body">
      <div class="table-wrap"><table><thead><tr><th>등수 (게임당 — 모든 조합 동일)</th><th class="num">확률</th></tr></thead><tbody>${per
        .map((p) => `<tr><td>${p.rank}등 (${p.label})</td><td class="num">${inv(p.probability)}</td></tr>`)
        .join('')}<tr><td>4등 이상</td><td class="num">${inv(p4)}</td></tr><tr><td>아무 등수</td><td class="num">${inv(anyPer)}</td></tr></tbody></table></div>
      <p>${g}게임 묶음은 당첨번호 8,145,060가지를 전부 대입한 정확값입니다. 게임끼리 번호가 겹치지 않으면 두 게임이 동시에 4개 이상 맞을 수 없어(4+4−1 &gt; 6) 4등·3등 이상 확률이 이론 최대이고, 당첨(5등 이상)도 최대 ${pct(g * anyPer, 2)}에 가깝습니다. 1등 ${inv(o.first)}.</p>
      <p>제외 규칙: ${RULES.filter((r) => !rec.disabled.includes(r.key)).map((r) => r.name).join(' · ')}. 과거 당첨번호가 드물게 보인 모양이지만, 공정한 추첨에서는 모든 조합의 확률이 같아 확률을 바꾸지 않습니다. 근거와 감시 결과는 검정 탭 "추천 규칙 감시"에 있습니다.</p>
      <p>매주 ${g}게임: 1년 내 4등 이상 ${pct(1 - (1 - o.atLeast4) ** 52, 1)} · 10년 내 1등 ${pct(firstPrizeOverYears(g, 10), 3)}</p>
      ${ratios ? `<p>베이지안 참고 (과거 빈도를 믿는다면 1등 확률 배수): ${ratios.map((r) => `×${fx(r, 2)}`).join(' · ')} — 베이즈 인자가 균등 모형을 지지하므로 최선 추정은 위 확률입니다.</p>` : ''}
    </div></details>`;
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
function ballsHit(nums: readonly number[], win: ReadonlySet<number> | null): string {
  const html = balls(nums, undefined, 'sm');
  if (!win) return html;
  return html.replace(/<span class="ball ([^"]*)">(\d+)<\/span>/g, (m, cls, n) => (win.has(Number(n)) ? m : `<span class="ball ${cls} miss">${n}</span>`));
}

/** 스캔한 용지 확인 화면 */
export function ticketPreviewHtml(t: Ticket, nextRound: number): string {
  const when = t.round === nextRound ? '이번 회차' : t.round < nextRound ? '지난 회차' : '다음 회차 이후';
  return `<h2>${t.round}회 <span class="muted small">${when} · ${t.games.length}게임</span></h2>
    ${t.games.map((g) => `<div class="pick">${balls(g.numbers, undefined, 'sm')}<span class="muted small">${'ABCDE'[g.slot]} ${MODE_LABEL[g.mode]}</span></div>`).join('')}`;
}

/** 내 구매: 성적표(구매액·당첨금·등수별) + 회차별 용지 */
export function purchasesHtml(list: StoredPurchase[] | null, pending: number, draws: readonly Draw[]): string {
  const queued = pending ? `<p class="line warn-text">맥북에 아직 못 보낸 용지 ${pending}장 — 연결되면 자동 전송</p>` : '';
  if (list === null) return queued + '<p class="muted small">맥북 서버 연결 안 됨</p>';
  if (list.length === 0) return queued + '<p class="muted small">구매 기록 없음 — 용지 QR을 스캔하세요</p>';
  const graded = list.filter((p) => p.matched !== null);
  const spent = list.length * 1000;
  const won_ = graded.reduce((a, p) => a + (p.prizeAmount ?? 0), 0);
  const drawMap = new Map(draws.map((d) => [d.round, d]));
  const byRound = new Map<number, StoredPurchase[]>();
  for (const p of list) byRound.set(p.targetRound, [...(byRound.get(p.targetRound) ?? []), p]);
  const rounds = [...byRound.entries()]
    .map(([round, ps]) => {
      const d = drawMap.get(round);
      const win = d ? new Set(d.numbers) : null;
      const isGraded = ps[0].matched !== null;
      const prize = ps.reduce((a, p) => a + (p.prizeAmount ?? 0), 0);
      const best = isGraded ? Math.min(...ps.map((p) => p.prizeRank || 9)) : 9;
      const summary = !isGraded ? '추첨 전' : best === 9 ? '낙첨' : `${best}등 · ${won(prize)}`;
      const tickets = [...new Set(ps.map((p) => p.ticketKey))];
      return `<details class="buy"><summary class="hist-row"><span class="hist-round">${round}회</span><span class="muted small">${ps.length}게임</span><span class="hist-sum ${best < 9 ? 'win' : ''}">${summary}</span></summary>
        ${tickets
          .map((k) => ps.filter((p) => p.ticketKey === k).sort((a, b) => a.slot - b.slot))
          .map((g) => `${g.map((p) => `<div class="pick">${ballsHit(p.numbers, win)}<span class="muted small">${MODE_LABEL[p.mode]}${p.matched !== null ? ` · ${p.matched}개${p.prizeRank ? ` <b>${p.prizeRank}등</b>` : ''}` : ''}</span></div>`).join('')}
            <div class="row end"><button class="btn sm" data-del-ticket="${esc(g[0].ticketKey)}">이 용지 삭제</button></div>`)
          .join('')}
      </details>`;
    })
    .join('');
  return `${queued}<div class="tiles">
      ${tile('구매', won(spent), `${list.length}게임 · ${byRound.size}회`)}
      ${tile('당첨금', won(won_), graded.length ? `회수율 ${pct(won_ / (graded.length * 1000), 0)} (추첨된 ${graded.length}게임)` : '추첨 전')}
    </div>
    ${graded.length ? `<div class="table-wrap"><table><thead><tr><th>추첨된 ${graded.length}게임</th><th class="num">실제</th><th class="num">이론 기대</th></tr></thead><tbody>${scorecard(graded)}</tbody></table></div>` : ''}
    ${rounds}`;
}

export function historyHtml(recs: StoredRecommendation[] | null): string {
  if (recs === null) return '<p class="muted small">맥북 서버 연결 안 됨</p>';
  if (recs.length === 0) return '<p class="muted small">기록 없음</p>';
  const byRound = new Map<number, StoredRecommendation[]>();
  for (const r of recs) byRound.set(r.targetRound, [...(byRound.get(r.targetRound) ?? []), r]);
  const list = [...byRound.entries()]
    .map(([round, list]) => {
      const graded = list[0].matched !== null;
      // 5게임 중 가장 좋은 등수 (낙첨 = 0 → 비교용으로 9)
      const bestRank = graded ? Math.min(...list.map((r) => r.prizeRank || 9)) : 9;
      const maxMatch = Math.max(...list.map((r) => r.matched ?? 0));
      const summary = !graded ? '추첨 전' : bestRank === 9 ? `낙첨 · 최다 ${maxMatch}개 일치` : `${bestRank}등 당첨`;
      return `<div class="hist-row"><span class="hist-round">${round}회</span><span class="muted small">${list.length}게임</span><span class="hist-sum ${bestRank < 9 ? 'win' : ''}">${summary}</span></div>`;
    })
    .join('');
  return list;
}

export const homeView: View = {
  key: 'home',
  label: '홈',
  icon: ICONS.home,
  usesPeriod: true,
  render: ({ draws, period, range, home }) => {
    const last = draws.at(-1)!;
    const p1 = last.prizes[0];
    const latest = card(
      `${last.round}회 <span class="muted">${last.date.slice(5).replace('-', '.')}</span>`,
      balls(last.numbers, last.bonus) +
        (p1.winners ? `<p class="line">1등 <b>${p1.winners}명</b> · 1인 <b>${eok(p1.amount)}</b></p>` : ''),
    );

    const rec = home!.rec;
    let body: string;
    if (!period || !rec) body = loading(`${range.count.toLocaleString()}회 기준 계산 중…`);
    else
      body = `<div id="picks">${picksHtml(rec)}</div>
        <div class="row between"><span class="muted small" id="picks-foot">${picksFooter(rec)}</span><button class="btn sm" id="btn-regen">다른 조합</button></div>
        <div id="odds">${oddsHtml(rec, thetaOf(period))}</div>`;
    const picks = card(`${last.round + 1}회 추천`, body, { badge: rec?.picks.length ? strengthBadge(rec) : '' });
    const mine = card('내 구매', '<div id="purchases"><p class="muted small">불러오는 중…</p></div>', { badge: '<button class="btn sm" id="btn-scan">QR 스캔</button>' });
    const history = card('지난 추천', '<div id="history"><p class="muted small">불러오는 중…</p></div>');
    return latest + picks + mine + history;
  },
};
