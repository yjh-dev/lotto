/** 번호 · 패턴 화면 (선택 기간 기준) */
import { bars, css, line, mount, refLine } from './charts.ts';
import { ICONS, type View, type ViewCtx } from './view.ts';
import { $, badge, card, chartBox, formula, fx, inkOn, loading, mix, pct, pv, tile } from './ui.ts';

const waiting = (c: ViewCtx) => loading(`${c.range.count.toLocaleString()}회 분석 중…`);

// ───────────────────────── 번호 ─────────────────────────

type SortKey = 'num' | 'many' | 'few' | 'since';
let sortKey: SortKey = 'many';

function numberRows(c: ViewCtx): string {
  const a = c.period!.analysis;
  const tests = a.numbers.tests;
  const rows = a.numbers.stats.map((s) => ({ ...s, q: tests[s.number - 1].qValue }));
  rows.sort((x, y) =>
    sortKey === 'num' ? x.number - y.number : sortKey === 'many' ? y.count - x.count : sortKey === 'few' ? x.count - y.count : y.sinceLast - x.sinceLast,
  );
  return rows
    .map((r) => `<tr><td><b>${r.number}</b></td><td class="num">${r.count}</td><td class="num">${r.z > 0 ? '+' : ''}${fx(r.z, 2)}</td><td class="num">${pv(r.q)}</td><td class="num">${r.sinceLast}</td></tr>`)
    .join('');
}

export const numbersView: View = {
  key: 'numbers',
  label: '번호',
  icon: ICONS.numbers,
  usesPeriod: true,
  render: (c) => {
    if (!c.period) return waiting(c);
    const a = c.period.analysis;
    const neg = css('--div-neg');
    const mid = css('--div-mid');
    const pos = css('--div-pos');
    const cells = a.numbers.stats
      .map((st) => {
        const bg = mix(mid, st.z < 0 ? neg : pos, Math.min(1, Math.abs(st.z) / 3));
        return `<div class="cell" style="background:${bg};color:${inkOn(bg)}" title="${st.number}번 ${st.count}회">${st.number}<span>${st.z > 0 ? '+' : ''}${fx(st.z, 1)}</span></div>`;
      })
      .join('');
    const chips = ([['many', '많이'], ['few', '적게'], ['since', '미출현'], ['num', '번호순']] as const)
      .map(([k, l]) => `<button class="chip ${k === sortKey ? 'on' : ''}" data-sort="${k}">${l}</button>`)
      .join('');
    return (
      card('출현 횟수 — 기대 대비', `<p class="line muted">기대 ${fx(a.numbers.expected, 1)}회 ± ${fx(a.numbers.sd, 1)}</p>` + chartBox('c-freq', 'tall'), {
        badge: badge(a.frequency.pValue),
        theory: `<p>한 번호의 출현 횟수 ~ Binomial(n, 6/45). n이 크면 정규근사(중심극한정리)로 z-점수를 씁니다.</p>
          ${formula('기대 = n·6/45,  SD = √(n·(6/45)·(39/45))')}
          <p>균등성은 카이제곱으로 검정하되, 한 회차의 6개가 서로 달라 횟수들이 독립이 아니므로 보정합니다.</p>
          ${formula('Σ(O−E)²/E ~ (39/44)·χ²(44)  →  ×44/39 후 χ²(44)로 판정')}
          <p>대수의 법칙은 <i>비율</i>이 6/45로 수렴한다는 뜻 — 덜 나온 번호가 "따라잡지" 않습니다.</p>`,
      }) +
      card('z-점수 지도', `<div class="heat">${cells}</div><div class="legend-bar"><span>−3</span><div class="ramp" style="background:linear-gradient(90deg,${neg},${mid},${pos})"></div><span>+3</span></div>`) +
      card(
        '번호별',
        `<div class="chips">${chips}</div>
         <div class="table-wrap"><table><thead><tr><th>번호</th><th class="num">횟수</th><th class="num">z</th><th class="num">q</th><th class="num">미출현</th></tr></thead><tbody id="num-rows">${numberRows(c)}</tbody></table></div>`,
        { theory: '<p>q = 45개 번호 검정에 Benjamini–Hochberg(FDR) 보정을 한 값. 45번 검정하면 공정해도 p&lt;0.05가 평균 2.25개 나오므로 q로 판단합니다.</p><p>미출현 = 마지막 출현 후 지난 회차 수. 재출현 간격은 기하분포(무기억성)라 미출현이 길어도 다음 회차 확률은 6/45 그대로입니다.</p>' },
      )
    );
  },
  after: (c) => {
    if (!c.period) return;
    const a = c.period.analysis;
    const sd = a.numbers.sd;
    const dev = a.numbers.stats.map((s) => s.count - s.expected);
    const lim = Math.max(10, Math.ceil((Math.max(...dev.map(Math.abs), 2.5 * sd) * 1.1) / 5) * 5);
    mount($('#c-freq'), 'bar', a.numbers.stats.map((s) => s.number), [
      bars('기대보다 적음', dev.map((d) => (d < 0 ? d : null)), css('--div-neg'), { grouped: false, barPercentage: 0.75, categoryPercentage: 0.9 }),
      bars('기대보다 많음', dev.map((d) => (d >= 0 ? d : null)), css('--div-pos'), { grouped: false, barPercentage: 0.75, categoryPercentage: 0.9 }),
      refLine('±2σ', 2 * sd, 45, css('--muted'), 1),
      refLine('−2σ', -2 * sd, 45, css('--muted'), 1),
    ], { yMin: -lim, yMax: lim, format: (v) => `${v > 0 ? '+' : ''}${fx(v, 1)}회` });
    document.querySelectorAll<HTMLButtonElement>('[data-sort]').forEach((b) =>
      b.addEventListener('click', () => {
        sortKey = b.dataset.sort as SortKey;
        document.querySelectorAll('[data-sort]').forEach((x) => x.classList.toggle('on', x === b));
        $('#num-rows')!.innerHTML = numberRows(c);
      }),
    );
  },
};

// ───────────────────────── 패턴 ─────────────────────────

function binSum(values: number[], pmf: number[], width: number, lo: number, hi: number) {
  const labels: string[] = [];
  const obs: number[] = [];
  const exp: number[] = [];
  for (let b = lo; b < hi; b += width) {
    labels.push(`${b}`);
    obs.push(values.filter((v) => v >= b && v < b + width).length);
    let p = 0;
    for (let s = b; s < b + width && s < pmf.length; s++) p += pmf[s];
    exp.push(p * values.length);
  }
  return { labels, obs, exp };
}

export const patternsView: View = {
  key: 'patterns',
  label: '패턴',
  icon: ICONS.patterns,
  usesPeriod: true,
  render: (c) => {
    if (!c.period) return waiting(c);
    const a = c.period.analysis;
    const cs = a.consecutive;
    const lbQ = a.summary.find((s) => s.key === 'ljungBox')!.qValue;
    return (
      card('합계', chartBox('c-sum'), {
        badge: badge(a.sum.ksMonteCarlo.pValue),
        theory: `<p>6-부분집합을 동적계획법으로 모두 세어 정확한 분포를 계산. 비복원추출이라 유한모집단 보정이 붙습니다.</p>
          ${formula('E[S] = 138,  Var[S] = 6·(45²−1)/12·39/44 ≈ 897')}
          <p>KS 검정(누적분포 최대 차이). 이산분포라 몬테카를로로 p값을 보정합니다.</p>`,
      }) +
      card('홀수 개수', chartBox('c-odd', 'short'), { badge: badge(a.oddEven.pValue), theory: '<p>홀수 23·짝수 22개에서 6개 → 초기하분포. 카이제곱 적합도 검정.</p>' }) +
      card('1~22 개수', chartBox('c-low', 'short'), { badge: badge(a.lowHigh.pValue), theory: '<p>저번호 22·고번호 23개 → 초기하분포.</p>' }) +
      card('범위 (최대−최소)', chartBox('c-range'), {
        badge: badge(a.range.pValue),
        theory: `<p>순서통계량으로 유도한 정확한 분포.</p>${formula('P(R = r) = (45 − r)·C(r−1, 4) / C(45, 6)')}`,
      }) +
      card('연속번호 포함', `<div class="tiles">${tile('관측', pct(cs.observedRate))}${tile('이론', pct(cs.theoryRate))}</div>`, {
        badge: badge(cs.pValue),
        theory: `<p>이웃하지 않는 6개를 고르는 방법 C(40,6) → 연속번호가 없을 확률 C(40,6)/C(45,6) ≈ 47%.</p>`,
      }) +
      card('이월수 (직전 회차와 겹침)', chartBox('c-overlap', 'short'), {
        badge: badge(a.overlap.pValue),
        theory: '<p>초기하분포(45, 6, 6), 평균 36/45 = 0.8개. 회차 간 독립성 검정.</p>',
      }) +
      card('재출현 간격', chartBox('c-gap'), {
        badge: badge(a.gaps.pValue),
        theory: `<p>재출현까지 회차 수 ~ 기하분포(p = 6/45). 무기억성 때문에 오래 안 나온 번호도 다음 확률은 같습니다.</p>${formula('P(G > s+t | G > s) = P(G > t)')}`,
      }) +
      card('합계 자기상관', chartBox('c-acf', 'short'), {
        badge: badge(lbQ, 'q'),
        theory: `<p>Ljung–Box 검정. 점근 χ² 근사는 표본이 작으면 과대 기각하므로(50회에서 α=0.01이 실제 2.25%) 몬테카를로 p값을 쓰고, 검정 ${a.summary.length}개를 함께 했으므로 BH 보정한 q로 판정합니다 (몬테카를로 p=${pv(a.sum.ljungBoxMonteCarlo.pValue)}).</p>${formula('Q = n(n+2) Σ ρ̂ₖ²/(n−k)')}`,
      })
    );
  },
  after: (c) => {
    if (!c.period) return;
    const a = c.period.analysis;
    const s1 = css('--s1');
    const s2 = css('--s2');
    const muted = css('--muted');
    const f1 = (v: number) => fx(v, 1);
    const sb = binSum(a.sum.values, a.sum.pmf, 10, 30, 250);
    mount($('#c-sum'), 'bar', sb.labels, [bars('관측', sb.obs, s1), line('이론', sb.exp, s2, { pointRadius: 2 })], { format: f1 });
    const k7 = [0, 1, 2, 3, 4, 5, 6];
    mount($('#c-odd'), 'bar', k7, [bars('관측', a.oddEven.observed, s1), bars('이론', a.oddEven.expected, s2)], { format: f1 });
    mount($('#c-low'), 'bar', k7, [bars('관측', a.lowHigh.observed, s1), bars('이론', a.lowHigh.expected, s2)], { format: f1 });
    const rl = Array.from({ length: 40 }, (_, i) => i + 5);
    mount($('#c-range'), 'bar', rl, [bars('관측', rl.map((x) => a.range.observed[x] ?? 0), s1), line('이론', rl.map((x) => a.range.expected[x] ?? 0), s2)], { format: f1 });
    mount($('#c-overlap'), 'bar', k7, [bars('관측', a.overlap.observed, s1), bars('이론', a.overlap.expected, s2)], { format: f1 });
    const gl = Array.from({ length: 40 }, (_, i) => i + 1);
    mount($('#c-gap'), 'bar', gl, [bars('관측', a.gaps.observed.slice(0, 40), s1), line('기하분포', a.gaps.expected.slice(0, 40), s2)], { format: f1 });
    const acf = a.sum.ljungBox.acf;
    const lim = 1.96 / Math.sqrt(a.drawCount);
    const lags = acf.map((_, i) => i + 1);
    const y = Math.max(0.1, Math.ceil(Math.max(lim, ...acf.map(Math.abs)) * 12) / 10);
    mount($('#c-acf'), 'bar', lags, [bars('ρ', acf, s1, { barPercentage: 0.5 }), refLine('95% 한계', lim, lags.length, muted), refLine('−95%', -lim, lags.length, muted)], {
      yMin: -y,
      yMax: y,
      format: (v) => fx(v, 3),
    });
  },
};
