/** 저장소(SQLite)·요청 정책·API 서버 검증 — 메모리 DB, 실제 HTTP 요청 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openNodeDb } from '../src/db/node-db.ts';
import { LottoRepository } from '../src/db/repository.ts';
import { SCHEMA_VERSION } from '../src/db/schema.ts';
import { decideFetch, type Attempt } from '../src/data/fetchPolicy.ts';
import type { Draw } from '../src/data/types.ts';
import { createApp } from './app.ts';

function mkDraw(round: number, numbers: number[], bonus: number, opts: Partial<Draw> = {}): Draw {
  return {
    round,
    date: new Date(Date.UTC(2002, 11, 7) + (round - 1) * 7 * 86_400_000).toISOString().slice(0, 10),
    numbers: numbers as Draw['numbers'],
    bonus,
    prizes: ([1, 2, 3, 4, 5] as const).map((rank) => ({ rank, winners: rank * 10, amount: 1000 * (6 - rank) })),
    totalSales: 100_000_000,
    prizePool: 50_000_000,
    firstWinType: { unknown: 0, auto: 5, manual: 3, semiAuto: 2 },
    ...opts,
  };
}

async function freshRepo() {
  const repo = new LottoRepository(openNodeDb());
  await repo.init();
  return repo;
}

test('마이그레이션: 두 번 실행해도 안전, 버전 기록', async () => {
  const db = openNodeDb();
  const repo = new LottoRepository(db);
  await repo.init();
  await repo.init();
  const v = await db.all<{ version: number }>('SELECT version FROM schema_version');
  assert.deepEqual(v.map((r) => r.version), [SCHEMA_VERSION]);
});

test('저장 → 조회 왕복이 동일', async () => {
  const repo = await freshRepo();
  const d = [mkDraw(1, [10, 23, 29, 33, 37, 40], 16), mkDraw(2, [9, 13, 21, 25, 32, 42], 2)];
  assert.equal(await repo.upsertDraws(d.map((draw) => ({ draw })), 'seed'), 2);
  assert.deepEqual(await repo.getDraws(), d);
  assert.equal(await repo.lastRound(), 2);
});

test('우선순위: api가 manual을 덮어쓰고, seed·manual은 기존을 건드리지 않음', async () => {
  const repo = await freshRepo();
  await repo.upsertDraws([{ draw: mkDraw(1, [1, 2, 3, 4, 5, 6], 7, { totalSales: 0 }) }], 'manual');
  assert.equal(await repo.upsertDraws([{ draw: mkDraw(1, [8, 9, 10, 11, 12, 13], 14) }], 'seed'), 0);
  assert.deepEqual((await repo.getDraws())[0].numbers, [1, 2, 3, 4, 5, 6]);
  assert.equal(await repo.upsertDraws([{ draw: mkDraw(1, [8, 9, 10, 11, 12, 13], 14) }], 'api'), 0, '덮어쓰기는 "추가"가 아님');
  const after = (await repo.getDraws())[0];
  assert.deepEqual(after.numbers, [8, 9, 10, 11, 12, 13]);
  assert.equal(after.totalSales, 100_000_000);
});

test('잘못된 회차는 저장 거부 (트랜잭션 전체 취소)', async () => {
  const repo = await freshRepo();
  await assert.rejects(repo.upsertDraws([{ draw: mkDraw(1, [1, 2, 3, 4, 5, 6], 7) }, { draw: mkDraw(2, [1, 1, 3, 4, 5, 6], 7) }], 'api'));
  assert.equal(await repo.count(), 0);
});

test('추천 이력: 한 번만 기록, 추첨 후 채점', async () => {
  const repo = await freshRepo();
  const pick = (numbers: number[]) => ({ numbers });
  await repo.saveRecommendations(2, 2, [pick([1, 2, 3, 4, 5, 6]), pick([1, 2, 3, 10, 11, 12]), pick([20, 21, 22, 23, 24, 25])]);
  await repo.saveRecommendations(2, 99, [pick([40, 41, 42, 43, 44, 45])]); // 무시돼야 함
  assert.equal(await repo.evaluateRecommendations(), 0, '추첨 전에는 채점 없음');
  await repo.upsertDraws([{ draw: mkDraw(2, [1, 2, 3, 4, 5, 9], 6) }], 'api');
  assert.equal(await repo.evaluateRecommendations(), 3);
  const recs = await repo.listRecommendations();
  assert.deepEqual(recs.map((r) => [r.numbers[0], r.matched, r.prizeRank]), [[1, 5, 2], [1, 3, 5], [20, 0, 0]]);
});

test('요청 정책: 최신이면 안 함, 실패하면 1시간 → 6시간 간격', () => {
  // 2026-11-21(토) 23:00 KST = 14:00 UTC → 기대 1251회
  const now = new Date('2026-11-21T14:00:00Z');
  assert.equal(decideFetch(now, 1251, []).reason, 'up-to-date');
  assert.equal(decideFetch(now, 1250, []).reason, 'due');
  const miss = (minAgo: number): Attempt => ({ at: new Date(now.getTime() - minAgo * 60_000).toISOString(), target: 1251, gotNew: false });
  assert.equal(decideFetch(now, 1250, [miss(30)]).reason, 'backoff');
  assert.equal(decideFetch(now, 1250, [miss(61)]).reason, 'due');
  assert.equal(decideFetch(now, 1250, [miss(70), miss(200)]).reason, 'backoff', '2연속 실패 → 6시간');
  assert.equal(decideFetch(now, 1250, [miss(70), miss(200)], true).reason, 'forced');
  // 추첨 전(토 20:00 KST)에는 1251회를 기대하지 않음
  assert.equal(decideFetch(new Date('2026-11-21T11:00:00Z'), 1250, []).reason, 'up-to-date');
});

test('API 서버: 덧붙일 회차만 반환', async () => {
  const repo = await freshRepo();
  await repo.upsertDraws([1, 2, 3].map((r) => ({ draw: mkDraw(r, [r, 10 + r, 20 + r, 30 + r, 40, 45], 1 + r) })), 'api');
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const r = await fetch(`${base}/api/draws?after=1`);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    const body = (await r.json()) as { latest: number; draws: Draw[] };
    assert.equal(body.latest, 3);
    assert.deepEqual(body.draws.map((d) => d.round), [2, 3]);
    assert.equal(((await (await fetch(`${base}/api/draws`)).json()) as { draws: Draw[] }).draws.length, 3);
    assert.equal((await fetch(`${base}/api/draws?after=-1`)).status, 400);
    assert.equal((await fetch(`${base}/api/draws`, { method: 'POST' })).status, 405, '회차 데이터는 쓰기 불가');
    assert.equal(((await (await fetch(`${base}/api/health`)).json()) as { lastRound: number }).lastRound, 3);
  } finally {
    server.close();
  }
});

test('용지 QR 해석', async () => {
  const { parseLottoQr, QrError } = await import('../src/data/qr.ts');
  const t = parseLottoQr('http://m.dhlottery.co.kr/?v=1251q450312273341m010612213645n000000000000s020304050607q101112131415' + '1234567890');
  assert.equal(t.round, 1251);
  assert.deepEqual(t.games.map((g) => [g.slot, g.mode, g.numbers.join(',')]), [
    [0, 'auto', '3,12,27,33,41,45'], [1, 'manual', '1,6,12,21,36,45'], [3, 'semi', '2,3,4,5,6,7'], [4, 'auto', '10,11,12,13,14,15'],
  ], '빈 줄(n) 건너뜀, 번호 정렬, 끝의 일련번호 무시');
  assert.equal(parseLottoQr('https://dhlottery.co.kr/qr.do?method=winQr&v=1071q010203040506q050607080910').games.length, 2);
  assert.throws(() => parseLottoQr('https://example.com/'), QrError);
  assert.throws(() => parseLottoQr('?v=1251q010203040546'), QrError, '46번');
  assert.throws(() => parseLottoQr('?v=1251q010102030405'), QrError, '중복 번호');
});

test('구매 기록 API: 저장 · 중복 무시 · 추첨 후 채점(당첨금) · 삭제', async () => {
  const repo = await freshRepo();
  await repo.upsertDraws([{ draw: mkDraw(1, [1, 2, 3, 4, 5, 6], 7) }], 'api');
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/purchases`;
  const post = (qr: string) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ qr }) });
  const list = async () => ((await (await fetch(base)).json()) as { purchases: import('../src/db/repository.ts').StoredPurchase[] }).purchases;
  try {
    const qr = 'http://m.dhlottery.co.kr/?v=0002q010203040510q010203101112m202122232425';
    const r = await post(qr);
    assert.equal(r.status, 201);
    assert.equal(((await r.json()) as { saved: number }).saved, 3);
    assert.equal((await post(qr)).status, 200, '같은 용지 다시 스캔');
    assert.equal((await list()).length, 3);
    assert.equal((await post('https://example.com')).status, 400);
    assert.equal((await list()).every((p) => p.matched === null), true, '추첨 전');
    // 2회 추첨: 1,2,3,4,5,9 + 보너스 10
    await repo.upsertDraws([{ draw: mkDraw(2, [1, 2, 3, 4, 5, 9], 10) }], 'api');
    assert.equal(await repo.evaluatePurchases(), 3);
    const graded = (await list()).sort((a, b) => a.slot - b.slot);
    assert.deepEqual(graded.map((p) => [p.matched, p.prizeRank, p.prizeAmount]), [[5, 2, 4000], [3, 5, 1000], [0, 0, 0]]);
    // 이미 추첨된 회차의 용지는 저장 즉시 채점
    await post('?v=0002q010203040506');
    assert.equal((await list()).find((p) => p.ticketKey === '0002q010203040506')!.prizeRank, 3);
    const del = await fetch(`${base}?key=${encodeURIComponent('0002q010203040506')}`, { method: 'DELETE' });
    assert.equal(((await del.json()) as { deleted: number }).deleted, 1);
    assert.equal((await list()).length, 3);
  } finally {
    server.close();
  }
});
