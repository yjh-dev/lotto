/** 검정 화면: 검정 요약 + 접이식 상세(검정력·시기별·베이지안·시뮬레이션·백테스트·규칙 감시·당첨 확률) */
import type { McResult } from '../stats/analysis.ts';
import { prizeOdds, TOTAL_COMBOS } from '../stats/probability.ts';
import { bars, css, line, mount, refLine, SERIES } from './charts.ts';
import { ICONS, type View, type ViewCtx } from './view.ts';
import { $, badge, card, chartBox, formula, fx, loading, pct, pv, section, tile } from './ui.ts';

const plain = (t: string) => `<span class="badge plain">${t}</span>`;

function histogram(mc: McResult, bins = 20) {
  const all = [...mc.nullSample, mc.observed];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const w = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const v of mc.nullSample) counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++;
  return { counts, obsBin: Math.min(bins - 1, Math.floor((mc.observed - lo) / w)), labels: counts.map((_, i) => lo + (i + 0.5) * w) };
}

const MC_ITEMS: { id: string; title: string; get: (c: ViewCtx) => McResult; d: number }[] = [
  { id: 'mc-freq', title: '번호 빈도 X²', get: (c) => c.period!.analysis.frequency.monteCarlo, d: 1 },
  { id: 'mc-maxz', title: '최대 |z|', get: (c) => c.period!.analysis.maxAbsZ, d: 2 },
  { id: 'mc-pairs', title: '번호쌍 X²', get: (c) => c.period!.analysis.pairs, d: 0 },
  { id: 'mc-ks', title: '합계 KS D', get: (c) => c.period!.analysis.sum.ksMonteCarlo, d: 3 },
];

/** 섹션을 펼칠 때 그릴 차트 */
const MOUNTS: Record<string, (c: ViewCtx) => void> = {
  bayes: (c) => {
    const post = c.period!.analysis.bayes.posterior;
    const s1 = css('--s1');
    mount($('#c-post'), 'bar', post.map((p) => p.number), [
      bars('95% 신용구간', post.map((p) => [p.lower * 600, p.upper * 600]), s1 + '66', { borderSkipped: false, barPercentage: 0.7 }),
      line('사후평균', post.map((p) => p.nextDrawProb * 100), s1, { showLine: false, pointRadius: 3 }),
      refLine('균등 13.33%', 100 * (6 / 45), 45, css('--s2'), 2),
    ], { yMin: Math.floor(Math.min(...post.map((p) => p.lower * 600)) - 0.5), yMax: Math.ceil(Math.max(...post.map((p) => p.upper * 600)) + 0.5), format: (v) => `${fx(v, 2)}%` });
  },
  simulation: (c) => {
    for (const it of MC_ITEMS) {
      const h = histogram(it.get(c));
      mount($(`#${it.id}`), 'bar', h.labels.map((x) => fx(x, it.d)), [
        bars('시뮬레이션', h.counts, h.counts.map((_, i) => (i === h.obsBin ? css('--s2') : css('--axis'))), { barPercentage: 1, categoryPercentage: 0.92 }),
      ], { legend: false, format: (v) => fx(v, 0) });
    }
  },
  backtest: (c) => {
    const bt = c.period!.backtest;
    if (!bt) return;
    const skip = Math.min(30, Math.floor(bt[0].games / 3));
    const n = bt[0].cumulativeMean.length - skip;
    const start = Math.max(262, c.range.from) + skip;
    mount($('#c-bt'), 'line', Array.from({ length: n }, (_, i) => start + i), [
      ...bt.map((b, i) => line(b.name, b.cumulativeMean.slice(skip), css(SERIES[i % SERIES.length]), { borderWidth: 1.5 })),
      refLine('이론 0.8', 0.8, n, css('--ink-2'), 1.5),
    ], { yMin: 0.4, yMax: 1.2, format: (v) => fx(v, 3) });
  },
  bonus: (c) => {
    const b = c.period!.analysis.bonus;
    const dev = b.counts.slice(1).map((x) => x - b.expected);
    const sd = Math.sqrt(b.expected * (44 / 45));
    const lim = Math.max(10, Math.ceil((Math.max(...dev.map(Math.abs), 2.5 * sd) * 1.1) / 5) * 5);
    mount($('#c-bonus'), 'bar', dev.map((_, i) => i + 1), [
      bars('기대보다 적음', dev.map((d) => (d < 0 ? d : null)), css('--div-neg'), { grouped: false, barPercentage: 0.75 }),
      bars('기대보다 많음', dev.map((d) => (d >= 0 ? d : null)), css('--div-pos'), { grouped: false, barPercentage: 0.75 }),
      refLine('±2σ', 2 * sd, 45, css('--muted'), 1),
      refLine('−2σ', -2 * sd, 45, css('--muted'), 1),
    ], { yMin: -lim, yMax: lim, format: (v) => `${v > 0 ? '+' : ''}${fx(v, 1)}회` });
  },
};

export const testsView: View = {
  key: 'tests',
  label: '검정',
  icon: ICONS.tests,
  usesPeriod: true,
  render: (c) => {
    if (!c.period) return loading(`${c.range.count.toLocaleString()}회 분석 중…`);
    const a = c.period.analysis;
    const sig = a.summary.filter((s) => s.qValue < 0.05).length;

    const summary = card(
      `검정 ${a.summary.length}개`,
      `<div class="table-wrap"><table><thead><tr><th>검정</th><th class="num">p</th><th class="num">q</th><th></th></tr></thead><tbody>${a.summary
        .map((s) => `<tr><td>${s.name}</td><td class="num">${pv(s.pValue)}</td><td class="num">${pv(s.qValue)}</td><td class="num">${s.qValue < 0.05 ? '<span class="dot sig">!</span>' : '<span class="dot ok">✓</span>'}</td></tr>`)
        .join('')}</tbody></table></div>`,
      {
        badge: sig === 0 ? '<span class="badge ok">✓ 모두 무작위</span>' : `<span class="badge sig">! ${sig}개 유의</span>`,
        theory: `<p>귀무가설 H₀: 매 회차 45개 중 6개를 균등·독립으로 추출. q = 검정 전체에 Benjamini–Hochberg 보정.</p>${formula('q₍ᵢ₎ = min_{j≥i} ( m/j · p₍ⱼ₎ )')}<p>"무작위와 구별 안 됨"은 편향이 없다는 증명이 아닙니다 — 아래 검정력 참고.</p>`,
      },
    );

    // 검정력
    const pw = a.power;
    const power = section(
      'power',
      '검정력',
      plain(`검출 한계 ${fx(pw.mdePerNumber * 100, 0)}%`),
      `<div class="table-wrap"><table><thead><tr><th>편향</th><th class="num">번호별</th><th class="num">전체 χ²</th></tr></thead><tbody>${pw.rows
        .map((r) => `<tr><td>+${fx(r.bias * 100, 0)}%</td><td class="num">${pct(r.perNumber, 0)}</td><td class="num">${pct(r.omnibus, 0)}</td></tr>`)
        .join('')}</tbody></table></div>
       <p class="line muted">80% 검출 최소 편향: ${pw.byDraws.map((b) => `${b.draws.toLocaleString()}회 ${fx(b.mdePerNumber * 100, 0)}%`).join(' · ')}</p>`,
      `<p>검정력 = 편향이 실제로 있을 때 잡아낼 확률(1−β). 가중치 w=1+δ인 번호의 회차당 출현 확률은 정확식으로 계산:</p>
       ${formula('π₁ = 1 − Π_{k=0..5} (44−k)/(44−k+w)')}
       <p>번호별: Bonferroni(|z|>3.26) 정규근사. 전체: 비중심 카이제곱.</p>${formula("X²·44/39 ~ χ'²(44, λ),  λ = (44/39)·n·Σ(πᵢ−p)²/p")}`,
    );

    // 시기별
    const e = a.eras;
    const eras = section(
      'eras',
      '시기별 안정성',
      badge(e.homogeneity.pValue),
      `<div class="table-wrap"><table><thead><tr><th>구간</th><th class="num">p</th><th class="num">q</th></tr></thead><tbody>${e.segments
        .map((s) => `<tr><td>${s.from}~${s.to}회</td><td class="num">${pv(s.pValue)}</td><td class="num">${pv(s.qValue)}</td></tr>`)
        .join('')}<tr><td>최근 ${e.recent.draws}회</td><td class="num">${pv(e.recent.pValue)}</td><td class="num">–</td></tr></tbody></table></div>`,
      `<p>번호(45) × 구간(${e.segments.length}) 분할표 동질성 검정. 비복원추출로 자유도가 정확하지 않아 몬테카를로 ${c.period.iterations}회로 p값 산출.</p>${formula('X² = ΣΣ (Oᵢⱼ − Eᵢⱼ)²/Eᵢⱼ')}`,
    );

    // 베이지안
    const b = a.bayes;
    const bf = b.bayesFactors;
    const bayes = section(
      'bayes',
      '베이지안 (번호별 확률 추정)',
      plain(bf.every((x) => x.logBF10 < 0) ? '균등 모형 지지' : bf[0].interpretation),
      chartBox('c-post', 'tall') +
        `<div class="table-wrap"><table><thead><tr><th class="num">사전 α</th><th class="num">log₁₀BF₁₀</th><th>해석</th></tr></thead><tbody>${bf
          .map((x) => `<tr><td class="num">${x.alpha}</td><td class="num">${fx(x.logBF10 / Math.LN10, 2)}</td><td>${x.interpretation}</td></tr>`)
          .join('')}</tbody></table></div>
         <div class="tiles">${tile('엔트로피', `${fx(a.entropy.entropy, 4)}`, `최대 ${fx(a.entropy.maxEntropy, 4)} bits`)}${tile('KL(관측‖균등)', a.entropy.klToUniform.toExponential(2), 'bits')}</div>`,
      `${formula('사후  θ | 데이터 ~ Dirichlet(α + c₁, …, α + c₄₅)\nBF₁₀ = p(D | 편향 모형) / p(D | 균등 모형)')}<p>BF₁₀ &lt; 1(log &lt; 0)이면 균등 모형 지지. 엔트로피 H = −Σq log₂q, KL = log₂45 − H.</p>`,
    );

    // 시뮬레이션
    const sim = section(
      'simulation',
      `시뮬레이션 (공정 로또 ${c.period.iterations}회)`,
      badge(Math.min(...MC_ITEMS.map((it) => it.get(c).pValue)), 'p'),
      `<div class="mc-grid">${MC_ITEMS.map((it) => {
        const mc = it.get(c);
        return `<div><div class="mc-title">${it.title} <span class="muted">p ${pv(mc.pValue)}</span></div>${chartBox(it.id, 'short')}</div>`;
      }).join('')}</div><p class="line muted">주황 = 실제 데이터 위치</p>`,
      `<p>공정한 추첨을 그대로 재현해 통계량의 분포를 만들고 실제 값의 위치로 p값을 구함 (근사 공식 불필요).</p>${formula('p̂ = (#{시뮬레이션 ≥ 관측} + 1) / (반복 + 1)')}`,
    );

    // 백테스트
    const bt = c.period.backtest;
    const backtest = section(
      'backtest',
      '백테스트 (전략별 적중)',
      bt ? badge(Math.min(...bt.map((x) => x.qValue)), 'q') : plain('기간 밖'),
      bt
        ? chartBox('c-bt', 'tall') +
            `<div class="table-wrap"><table><thead><tr><th>전략</th><th class="num">평균 일치</th><th class="num">5등/4등</th><th class="num">수익률</th></tr></thead><tbody>${bt
              .map((x) => `<tr><td>${x.name}</td><td class="num">${fx(x.meanMatches)}</td><td class="num">${x.rankHits[4]} / ${x.rankHits[3]}</td><td class="num">${pct(x.returnRate)}</td></tr>`)
              .join('')}</tbody></table></div>`
        : '<p class="muted small">262회 이후가 포함된 기간에서만 가능합니다.</p>',
      `<p>각 회차를 그 이전 데이터만으로 예측(워크포워드). 독립 추첨이면 어떤 전략이든 일치 개수 ~ 초기하분포.</p>${formula('E[일치] = 0.8,  Var = 6·(6/45)·(39/45)·(39/44) ≈ 0.6145')}`,
    );

    // 추천 규칙 감시 — 제외 유형이 실제 당첨에서 이론보다 많이 나오는지
    const au = c.period.audit;
    const warned = au.filter((r) => r.warn).length;
    const rules = section(
      'rules',
      '추천 규칙 감시',
      warned ? `<span class="badge sig">! ${warned}개 해제</span>` : '<span class="badge ok">✓ 규칙 유지</span>',
      `<div class="table-wrap"><table><thead><tr><th>제외 규칙 (${au[0]?.draws.toLocaleString() ?? 0}회)</th><th class="num">무작위</th><th class="num">실제</th><th class="num">q</th></tr></thead><tbody>${au
        .map((r) => `<tr><td>${r.name}</td><td class="num">${r.expectedRate < 0.001 ? r.expectedRate.toExponential(1) : pct(r.expectedRate, 1)}</td><td class="num">${r.draws ? pct(r.observed / r.draws, 1) : '–'} <span class="muted">(${r.observed})</span></td><td class="num">${pv(r.qValue)} ${r.warn ? '<span class="dot sig">!</span>' : ''}</td></tr>`)
        .join('')}</tbody></table></div>
       <p class="line muted">두 비율이 비슷하면 "드문 모양"은 그런 조합이 원래 적어서일 뿐 — 당첨 확률은 모든 조합이 같습니다.</p>`,
      `<p>각 회차마다 그 직전까지의 과거로 실제 당첨번호와 무작위 조합(약 5만 개)을 같은 규칙으로 판정. 실제가 이론보다 많이 나왔는지 단측 이항검정 후 9개 규칙에 BH 보정.</p>
       ${formula('p = P(X ≥ 관측),  X ~ Binomial(회차 수, 무작위 비율)')}
       <p>q &lt; 0.05인 규칙은 데이터와 맞지 않는 것으로 보고 추천에서 자동 해제합니다. 규칙과 기준값은 결과를 보고 바꾸지 않습니다(사전 등록).</p>`,
    );

    // 보너스 번호
    const bn = a.bonus;
    const bsorted = bn.counts.map((x, i) => [i, x]).slice(1).sort((p, q) => q[1] - p[1]);
    const salesDraws = c.draws.filter((d) => d.round >= Math.max(262, c.range.from) && d.round <= c.range.to && d.totalSales > 0);
    const w2 = salesDraws.reduce((acc, d) => acc + d.prizes[1].winners, 0);
    const e2 = salesDraws.reduce((acc, d) => acc + ((d.totalSales / 1000) * 6) / TOTAL_COMBOS, 0);
    const bonus = section(
      'bonus',
      '보너스 번호 (2등)',
      badge(bn.test.pValue),
      chartBox('c-bonus') +
        `<div class="tiles">
           ${tile('기대 출현', `${fx(bn.expected, 1)}회`, `최다 ${bsorted[0][0]}번 ${bsorted[0][1]} · 최소 ${bsorted.at(-1)![0]}번 ${bsorted.at(-1)![1]}`)}
           ${salesDraws.length ? tile('2등 당첨자', `${fx(w2 / salesDraws.length, 1)}명`, `균등 구매 기대 ${fx(e2 / salesDraws.length, 1)}명 · ${salesDraws.length}회 평균`) : ''}
         </div>`,
      `<p>보너스는 본번호 6개를 뺀 39개 중 1개지만, 회차마다 어느 번호든 1/45로 같고 회차끼리 독립이므로 번호별 횟수 ~ 다항분포(n, 1/45) → 통상의 χ²(44)가 정확히 적용됩니다.</p>
       ${formula('P(2등) = C(6,5)·1 / C(45,6) = 6/8,145,060')}
       <p>2등 당첨자 수가 균등 구매 기대와 같다면, 보너스 번호에 대한 구매자 편향도 크지 않다는 뜻입니다.</p>`,
    );

    // 당첨 확률
    const odds = section(
      'odds',
      '당첨 확률',
      plain('초기하분포'),
      `<div class="table-wrap"><table><thead><tr><th>등수</th><th>조건</th><th class="num">확률</th></tr></thead><tbody>${prizeOdds()
        .map((p) => `<tr><td>${p.rank}등</td><td>${p.label}</td><td class="num">1 / ${Math.round(1 / p.probability).toLocaleString()}</td></tr>`)
        .join('')}</tbody></table></div>`,
      formula('P(k개 일치) = C(6,k)·C(39,6−k) / C(45,6)'),
    );

    return summary + `<div class="sections">${power}${eras}${bonus}${bayes}${sim}${backtest}${rules}${odds}</div>`;
  },
  after: (c) => {
    document.querySelectorAll<HTMLDetailsElement>('details.section').forEach((d) => {
      d.addEventListener('toggle', () => {
        if (d.open && !d.dataset.mounted) {
          MOUNTS[d.dataset.section!]?.(c);
          d.dataset.mounted = '1';
        }
      });
    });
  },
};
