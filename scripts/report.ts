/**
 * 실제 데이터 통계 리포트 (터미널)
 *   npm run report               기본 몬테카를로 1000회
 *   npm run report -- --iter 5000
 */
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Draw } from '../src/data/types.ts';
import { runAnalysis } from '../src/stats/analysis.ts';
import { runBacktest } from '../src/stats/backtest.ts';
import { auditRules } from '../src/recommend/rules.ts';
import { exactSetOdds } from '../src/recommend/odds.ts';
import { fitNumberPopularity } from '../src/recommend/popularity.ts';
import { recommend } from '../src/recommend/recommend.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { draws } = JSON.parse(await readFile(resolve(ROOT, 'data/draws.json'), 'utf8')) as { draws: Draw[] };
const iterArg = process.argv.indexOf('--iter');
const iterations = iterArg > 0 ? Number(process.argv[iterArg + 1]) : 1000;

const t0 = performance.now();
const a = runAnalysis(draws, { iterations });
const ms = performance.now() - t0;

const f = (x: number, d = 3) => x.toFixed(d);
const pv = (p: number) => (p < 0.001 ? '<0.001' : p.toFixed(3));
const verdict = (p: number) => (p < 0.05 ? '⚠ 유의 (p<0.05)' : '✓ 무작위와 구별 안 됨');
const h = (t: string) => console.log(`\n━━ ${t} ${'━'.repeat(Math.max(0, 52 - t.length))}`);

console.log(`로또 6/45 통계 리포트 — ${a.firstRound}~${a.lastRound}회 (${a.drawCount}회), 몬테카를로 ${iterations}회, ${f(ms / 1000, 1)}초`);

h('A. 당첨 확률 (초기하분포)');
for (const p of a.probability.prizes) console.log(`  ${p.rank}등 ${p.label.padEnd(8)} 1 / ${Math.round(1 / p.probability).toLocaleString().padStart(9)}`);
console.log(`  조합 엔트로피 log₂C(45,6) = ${f(a.probability.comboEntropyBits, 2)} bits`);

h('B·C. 번호 출현 빈도 균등성');
console.log(`  기대 출현 ${f(a.numbers.expected, 1)}회 ± ${f(a.numbers.sd, 1)} (Binomial)`);
const sorted = [...a.numbers.stats].sort((x, y) => y.count - x.count);
console.log(`  최다: ${sorted.slice(0, 5).map((s) => `${s.number}(${s.count}, z=${f(s.z, 2)})`).join(' ')}`);
console.log(`  최소: ${sorted.slice(-5).map((s) => `${s.number}(${s.count}, z=${f(s.z, 2)})`).join(' ')}`);
console.log(`  카이제곱 (비복원 보정 ×44/39) X²=${f(a.frequency.statistic, 2)}, df=44, p=${pv(a.frequency.pValue)}  ${verdict(a.frequency.pValue)}`);
console.log(`  G-검정 G=${f(a.frequency.gTest.statistic, 2)}  |  몬테카를로 p=${pv(a.frequency.monteCarlo.pValue)}`);
const minP = Math.min(...a.numbers.tests.map((t) => t.pValue));
const minQ = Math.min(...a.numbers.tests.map((t) => t.qValue));
const rawSig = a.numbers.tests.filter((t) => t.pValue < 0.05).map((t) => t.number);
console.log(`  번호별 검정: 보정 전 p<0.05 → [${rawSig.join(', ')}] (우연 기대 2.25개)`);
console.log(`              최소 p=${pv(minP)} → BH q=${pv(minQ)}, Bonferroni=${pv(Math.min(1, minP * 45))}  ${verdict(minQ)}`);
console.log(`  최대 |z| = ${f(a.maxAbsZ.observed, 2)} → 공정 로또 대비 ${f(a.maxAbsZ.percentile, 1)} 백분위, p=${pv(a.maxAbsZ.pValue)}`);
console.log(`  번호쌍 990개 X²=${f(a.pairs.observed, 1)} → 몬테카를로 p=${pv(a.pairs.pValue)}  ${verdict(a.pairs.pValue)}`);

h('D. 조합 특성 vs 이론 분포');
const st = a.sum.theory;
const sm = a.sum.values.reduce((x, y) => x + y, 0) / a.sum.values.length;
console.log(`  합계: 관측 평균 ${f(sm, 2)} (이론 ${st.mean}), 이론 SD ${f(st.sd, 2)}`);
console.log(`        KS D=${f(a.sum.ks.statistic, 4)} 점근 p=${pv(a.sum.ks.pValue)}, 몬테카를로 p=${pv(a.sum.ksMonteCarlo.pValue)}  ${verdict(a.sum.ksMonteCarlo.pValue)}`);
console.log(`  홀짝: X²=${f(a.oddEven.statistic, 2)}, df=${a.oddEven.df}, p=${pv(a.oddEven.pValue)}  ${verdict(a.oddEven.pValue)}`);
console.log(`  고저: X²=${f(a.lowHigh.statistic, 2)}, df=${a.lowHigh.df}, p=${pv(a.lowHigh.pValue)}  ${verdict(a.lowHigh.pValue)}`);
console.log(`  범위(순서통계량): X²=${f(a.range.statistic, 2)}, df=${a.range.df}, p=${pv(a.range.pValue)}  ${verdict(a.range.pValue)}`);
const c = a.consecutive;
console.log(`  연속번호 포함: 관측 ${f(c.observedRate * 100, 1)}% vs 이론 ${f(c.theoryRate * 100, 1)}%, z=${f(c.z, 2)}, p=${pv(c.pValue)}  ${verdict(c.pValue)}`);

h('E. 독립성 (회차 간 영향)');
console.log(`  이월수: 평균 ${f(a.overlap.mean, 3)} (이론 0.800), X²=${f(a.overlap.statistic, 2)}, p=${pv(a.overlap.pValue)}  ${verdict(a.overlap.pValue)}`);
console.log(`  재출현 간격: ${a.gaps.count}개, 평균 ${f(a.gaps.mean, 2)} (기하분포 이론 7.50), p=${pv(a.gaps.pValue)}  ${verdict(a.gaps.pValue)}`);
const lb = a.sum.ljungBox;
console.log(`  합계 Ljung–Box(10): Q=${f(lb.statistic, 2)}, 점근 p=${pv(lb.pValue)}, 몬테카를로 p=${pv(a.sum.ljungBoxMonteCarlo.pValue)}  ${verdict(a.sum.ljungBoxMonteCarlo.pValue)}`);
console.log(`     ρ₁..₅ = ${lb.acf.slice(0, 5).map((r) => f(r, 3)).join(', ')}  (95% 한계 ±${f(1.96 / Math.sqrt(a.drawCount), 3)})`);
const runsMinQ = Math.min(...a.runs.map((r) => r.qValue));
const runsSig = a.runs.filter((r) => r.pValue < 0.05).map((r) => r.number);
console.log(`  런 검정 45개: 보정 전 p<0.05 → [${runsSig.join(', ')}], 최소 BH q=${pv(runsMinQ)}  ${verdict(runsMinQ)}`);

h('F. 베이지안 (디리클레–다항)');
const post = [...a.bayes.posterior].sort((x, y) => y.nextDrawProb - x.nextDrawProb);
const pr = (p: (typeof post)[number]) => `${p.number}: ${f(p.nextDrawProb * 100, 2)}% [${f(p.lower * 600, 2)}~${f(p.upper * 600, 2)}]`;
console.log(`  다음 회차 출현확률 (균등 13.33%) 상위  ${post.slice(0, 3).map(pr).join('  ')}`);
console.log(`                                   하위  ${post.slice(-3).map(pr).join('  ')}`);
for (const b of a.bayes.bayesFactors) console.log(`  α=${String(b.alpha).padEnd(5)} log₁₀BF₁₀ = ${f(b.logBF10 / Math.LN10, 2).padStart(7)}  → ${b.interpretation}`);

h('G. 정보이론');
console.log(`  번호 분포 엔트로피 ${f(a.entropy.entropy, 5)} / 최대 ${f(a.entropy.maxEntropy, 5)} bits (효율 ${f(a.entropy.efficiency * 100, 4)}%)`);
console.log(`  KL(관측‖균등) = ${a.entropy.klToUniform.toExponential(3)} bits`);

h('검정력 — 편향이 있었다면 잡아낼 수 있었나');
for (const r of a.power.rows) console.log(`  번호 하나가 ${f(r.bias * 100, 0)}% 더 잘 뽑힐 때 검출 확률: 번호별 ${f(r.perNumber * 100, 0)}%, 전체 χ² ${f(r.omnibus * 100, 0)}%`);
console.log(`  80% 검출 최소 편향: 번호별 ${f(a.power.mdePerNumber * 100, 0)}%, 전체 χ² ${f(a.power.mdeOmnibus * 100, 0)}%  → "구별 안 됨" ≠ "편향 없음"`);

h('시기별 안정성');
for (const e of a.eras.segments) console.log(`  ${e.from}~${e.to}회: p=${pv(e.pValue)} q=${pv(e.qValue)}`);
console.log(`  구간 간 동질성 X²=${f(a.eras.homogeneity.observed, 1)}, 몬테카를로 p=${pv(a.eras.homogeneity.pValue)}  ${verdict(a.eras.homogeneity.pValue)}`);
console.log(`  최근 ${a.eras.recent.draws}회: p=${pv(a.eras.recent.pValue)}`);

h('I. 워크포워드 백테스트 (262회~, 과거 데이터만 사용)');
const bt = runBacktest(draws);
console.log(`  이론: 어떤 전략이든 평균 일치 0.800개 (초기하분포), 게임 ${bt[0].games}회씩`);
for (const b of bt) {
  console.log(`  ${b.name.padEnd(14, '　')} 평균 ${f(b.meanMatches)}  p=${pv(b.pValue)} q=${pv(b.qValue)}  당첨 ${b.rankHits.join('/')}  수익률 ${f(b.returnRate * 100, 1)}%`);
}
console.log(`  → ${bt.every((b) => b.qValue >= 0.05) ? '✓ 모든 전략이 무작위와 구별 불가' : '⚠ 유의한 전략 있음'} (수익률 차이는 4·5등 몇 번의 운)`);

h('J. 추천 규칙 감시와 추천');
const audit = auditRules(draws);
console.log(`  규칙 | 무작위 비율 | 실제 비율 (회수) | q   (${audit[0].draws}회)`);
for (const r of audit) console.log(`    ${r.name.padEnd(22, '　')} ${f(r.expectedRate * 100, 2)}%  ${f((r.observed / r.draws) * 100, 2)}% (${r.observed})  q=${pv(r.qValue)}${r.warn ? '  ⚠ 해제' : ''}`);
const rec = recommend(draws, { disabled: audit.filter((r) => r.warn).map((r) => r.key), popularity: fitNumberPopularity(draws) });
const so = exactSetOdds(rec.picks.map((p) => p.numbers));
console.log();
console.log(`  ▶ ${rec.targetRound}회 추천 (번호 예측 아님 — 게임끼리 겹침 ≤1, 규칙 통과 후보 ${f(rec.eligibleShare * 100, 1)}%)`);
rec.picks.forEach((p, i) => console.log(`    ${i + 1}. ${p.numbers.map((n) => String(n).padStart(2)).join(' ')}`));
console.log(`    당첨(5등 이상) ${f(so.anyPrize * 100, 2)}% · 4등 이상 ${f(so.atLeast4 * 100, 3)}% (1/${Math.round(1 / so.atLeast4)}) · 3등 이상 1/${Math.round(1 / so.atLeast5).toLocaleString()}`);
console.log('    ※ 모든 조합의 당첨 확률은 같음. 규칙은 확률을 바꾸지 않음.');

h(`종합: 검정 ${a.summary.length}개 전체에 BH(FDR) 보정`);
for (const r of a.summary) {
  console.log(`  ${r.name.padEnd(12, '　')} p=${pv(r.pValue).padStart(6)}  q=${pv(r.qValue).padStart(6)}  ${verdict(r.qValue)}`);
}
const sigCount = a.summary.filter((r) => r.pValue < 0.05).length;
console.log(`  보정 전 p<0.05: ${sigCount}개 (공정한 로또에서도 우연히 평균 ${(a.summary.length * 0.05).toFixed(1)}개)`);
console.log(`  보정 후 q<0.05: ${a.summary.filter((r) => r.qValue < 0.05).length}개`);
console.log();
