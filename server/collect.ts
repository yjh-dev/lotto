/**
 * 맥북 수집기 — launchd가 매시간 실행, "필요할 때만" 동행복권에 요청
 *
 *   npm run collect             정책에 따라 (최신이면 네트워크 요청 없이 종료)
 *   npm run collect -- --force  정책 무시하고 확인
 *   npm run collect -- --refresh  수집과 무관하게 추천 기록·초기 데이터 내보내기만 다시
 *
 * 새 회차를 받으면: SQLite 저장 → 지난 추천·구매 채점 → 다음 회차 기본 추천 기록 → 앱용 초기 데이터 내보내기
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { openNodeDb } from '../src/db/node-db.ts';
import { LottoRepository } from '../src/db/repository.ts';
import { decideFetch } from '../src/data/fetchPolicy.ts';
import { fetchRange } from '../src/data/dhlottery.ts';
import { validateDataset } from '../src/data/normalize.ts';
import type { RawDraw } from '../src/data/types.ts';
import { auditRules } from '../src/recommend/rules.ts';
import { fitNumberPopularity } from '../src/recommend/popularity.ts';
import { recommend } from '../src/recommend/recommend.ts';
import { DB_PATH, RAW_JSON, SEED_JSON } from './paths.ts';
import { backupSafely } from './backup.ts';

const args = new Set(process.argv.slice(2));
const log = (...m: unknown[]) => console.log(new Date().toISOString(), ...m);

async function postProcess(repo: LottoRepository) {
  const draws = await repo.getDraws();
  const warnings = validateDataset(draws);
  if (warnings.length) log(`⚠ 데이터 검증 경고 ${warnings.length}건:`, warnings.slice(0, 5).join(' / '));

  const graded = await repo.evaluateRecommendations();
  if (graded) log(`지난 추천 ${graded}게임 채점`);
  const bought = await repo.evaluatePurchases();
  if (bought) log(`구매 번호 ${bought}게임 채점`);

  // 규칙 감시(전체 회차) → 경고된 규칙 해제
  const audit = auditRules(draws);
  const disabled = audit.filter((a) => a.warn).map((a) => a.key);
  if (disabled.length) log(`⚠ 규칙 감시 경고 → 추천에서 해제: ${disabled.join(', ')}`);

  // 다음 회차 기본 추천 (시드 = 회차 번호 → 앱 "전체" 기간과 같은 결과). 이미 기록돼 있으면 유지.
  // 두 방식 모두 기록 → 어느 쪽을 샀든 매주 둘 다 채점해 성적 비교
  const popularity = fitNumberPopularity(draws);
  for (const strategy of ['default', 'hot'] as const) {
    const rec = recommend(draws, { disabled, popularity, strategy });
    await repo.saveRecommendations(rec.targetRound, rec.seed, rec.picks, new Date(), strategy);
    log(`${rec.targetRound}회 ${strategy === 'hot' ? '핫 번호' : '기본'} 추천 기록:`, rec.picks.map((p) => p.numbers.join(',')).join(' | '));
  }

  // 앱 빌드용 초기 데이터 + 원본 백업
  await writeFile(SEED_JSON, JSON.stringify({ updatedAt: new Date().toISOString(), latest: draws.at(-1)!.round, draws }));
  await writeFile(RAW_JSON, JSON.stringify(await repo.getRawDraws()));
  log(`초기 데이터 내보냄: ${draws.length}회`);
}

async function main() {
  const db = openNodeDb(DB_PATH);
  const repo = new LottoRepository(db);
  await repo.init();

  // 첫 실행: 기존 원본 백업에서 가져오기 (동행복권 재요청 불필요)
  if ((await repo.count()) === 0 && existsSync(RAW_JSON)) {
    const raws = JSON.parse(await readFile(RAW_JSON, 'utf8')) as RawDraw[];
    const n = await repo.upsertRaw(raws);
    log(`초기 적재: raw-draws.json에서 ${n}회`);
  }

  const last = await repo.lastRound();
  const attempts = (await repo.recentFetchLog(50)).map((e) => ({ at: e.attemptedAt, target: e.targetRound, gotNew: e.status === 'added' }));
  const decision = decideFetch(new Date(), last, attempts, args.has('--force'));

  let added = 0;
  if (!decision.fetch) {
    log(`요청 안 함 (${decision.reason}) — 보유 ${last}회, 기대 ${decision.target}회${decision.retryAt ? `, 재시도 ${decision.retryAt}` : ''}`);
  } else if (decision.target <= last) {
    await repo.logFetch({ targetRound: decision.target, status: 'up-to-date', added: 0, message: '강제 확인: 이미 최신' });
    log(`이미 최신 (${last}회)`);
  } else {
    try {
      const raws = await fetchRange(last, decision.target);
      added = await repo.upsertRaw(raws);
      const status = added > 0 ? 'added' : 'not-yet';
      await repo.logFetch({ targetRound: decision.target, status, added, message: added ? `${last + 1}~${last + added}회` : '아직 미반영' });
      log(added ? `새 회차 ${added}개 추가 (${last + 1}~${last + added}회)` : `${decision.target}회 아직 미반영 — 나중에 재시도`);
    } catch (e) {
      await repo.logFetch({ targetRound: decision.target, status: 'failed', added: 0, message: (e as Error).message });
      log('✗ 수집 실패:', (e as Error).message);
      process.exitCode = 1;
    }
  }

  if (added > 0 || args.has('--refresh')) await postProcess(repo);
  await db.close();
  // 토요일 추첨 후 새 회차·채점이 반영됐을 때만 백업
  if (added > 0) await backupSafely(`${last + added}회 수집`);
}

main().catch((e) => {
  log('✗', (e as Error).stack ?? e);
  process.exit(1);
});
