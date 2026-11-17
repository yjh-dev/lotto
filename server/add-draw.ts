/**
 * 자동 수집이 안 될 때 직접 입력 (맥북에서)
 *   npm run add-draw -- <회차> <YYYY-MM-DD> n1 n2 n3 n4 n5 n6 <보너스>
 *   예) npm run add-draw -- 1251 2026-11-21 3 11 19 27 38 44 7
 * 당첨자 수·판매액은 0으로 저장(번호 통계에만 반영). 나중에 자동 수집이 되면 공식 데이터로 덮어씀.
 */
import { openNodeDb } from '../src/db/node-db.ts';
import { LottoRepository } from '../src/db/repository.ts';
import type { Draw } from '../src/data/types.ts';
import { DB_PATH } from './paths.ts';

const [roundS, date, ...rest] = process.argv.slice(2);
const nums = rest.map(Number);
if (!roundS || !date || nums.length !== 7 || nums.some((n) => !Number.isInteger(n))) {
  console.error('사용법: npm run add-draw -- <회차> <YYYY-MM-DD> n1 n2 n3 n4 n5 n6 <보너스>');
  process.exit(1);
}
const repo = new LottoRepository(openNodeDb(DB_PATH));
await repo.init();
const last = await repo.lastRound();
const round = Number(roundS);
if (round !== last + 1) {
  console.error(`다음 회차(${last + 1}회)만 입력할 수 있습니다.`);
  process.exit(1);
}
const draw: Draw = {
  round,
  date,
  numbers: nums.slice(0, 6).sort((a, b) => a - b) as Draw['numbers'],
  bonus: nums[6],
  prizes: ([1, 2, 3, 4, 5] as const).map((rank) => ({ rank, winners: 0, amount: 0 })),
  totalSales: 0,
  prizePool: 0,
  firstWinType: { unknown: 0, auto: 0, manual: 0, semiAuto: 0 },
};
try {
  await repo.upsertDraws([{ draw }], 'manual');
  console.log(`${round}회 저장: ${draw.numbers.join(', ')} + ${draw.bonus} (수동). 'npm run collect -- --refresh'로 추천·초기 데이터 갱신`);
} catch (e) {
  console.error('✗', (e as Error).message);
  process.exit(1);
}
