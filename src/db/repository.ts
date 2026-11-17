/**
 * 로또 데이터 저장소 — 회차·당첨금·수집 기록·분석 캐시·추천 이력
 */
import type { Draw, RawDraw } from '../data/types.ts';
import { normalizeDraw, validateDraw } from '../data/normalize.ts';
import { migrate } from './schema.ts';
import type { SqlDb, SqlStatement, SqlValue } from './sql.ts';
import type { GameMode, Ticket } from '../data/qr.ts';

export type DrawSource = 'seed' | 'api' | 'manual';
export type FetchStatus = 'added' | 'up-to-date' | 'not-yet' | 'failed';

export interface FetchLogEntry {
  attemptedAt: string;
  targetRound: number;
  status: FetchStatus;
  added: number;
  message: string | null;
}

export interface StoredRecommendation {
  targetRound: number;
  /** 회차 안 순서 (기본 방식 0~, 핫 번호 방식 100~) */
  idx: number;
  strategy: 'default' | 'hot';
  numbers: number[];
  createdAt: string;
  /** 추첨 후 기록: 일치 개수, 등수(0 = 낙첨) */
  matched: number | null;
  prizeRank: number | null;
}

export interface StoredPurchase {
  ticketKey: string;
  slot: number;
  targetRound: number;
  mode: GameMode;
  numbers: number[];
  createdAt: string;
  /** 추첨 후 기록: 일치 개수, 등수(0 = 낙첨), 당첨금(원) */
  matched: number | null;
  prizeRank: number | null;
  prizeAmount: number | null;
  /** 당첨금 받은 날 (안 받았으면 null) */
  claimedAt: string | null;
}

/** 등수 판정 (보너스는 5개 일치일 때만) */
function grade(pick: readonly number[], numbers: readonly number[], bonus: number): { matched: number; rank: number } {
  const win = new Set(numbers);
  const m = pick.filter((n) => win.has(n)).length;
  return { matched: m, rank: m === 6 ? 1 : m === 5 ? (pick.includes(bonus) ? 2 : 3) : m === 4 ? 4 : m === 3 ? 5 : 0 };
}

interface DrawRow {
  round: number;
  draw_date: string;
  n1: number; n2: number; n3: number; n4: number; n5: number; n6: number;
  bonus: number;
  total_sales: number;
  prize_pool: number;
}

export class LottoRepository {
  // (Node 타입 제거 모드는 생성자 매개변수 속성을 지원하지 않아 명시적 필드로 선언)
  private readonly db: SqlDb;

  constructor(db: SqlDb) {
    this.db = db;
  }

  async init(): Promise<void> {
    await this.db.exec('PRAGMA foreign_keys = ON');
    await migrate(this.db);
  }

  async count(): Promise<number> {
    return (await this.db.all<{ c: number }>('SELECT COUNT(*) AS c FROM draws'))[0].c;
  }

  async lastRound(): Promise<number> {
    return (await this.db.all<{ r: number | null }>('SELECT MAX(round) AS r FROM draws'))[0].r ?? 0;
  }

  async getDraws(): Promise<Draw[]> {
    const [rows, prizes, types] = await Promise.all([
      this.db.all<DrawRow>('SELECT round, draw_date, n1, n2, n3, n4, n5, n6, bonus, total_sales, prize_pool FROM draws ORDER BY round'),
      this.db.all<{ round: number; rank: number; winners: number; amount: number }>('SELECT round, rank, winners, amount FROM prizes'),
      this.db.all<{ round: number; auto: number; manual: number; semi_auto: number; unknown: number }>('SELECT * FROM first_win_type'),
    ]);
    const prizeMap = new Map<number, Draw['prizes']>();
    for (const p of prizes) {
      if (!prizeMap.has(p.round)) prizeMap.set(p.round, ([1, 2, 3, 4, 5] as const).map((rank) => ({ rank, winners: 0, amount: 0 })));
      prizeMap.get(p.round)![p.rank - 1] = { rank: p.rank as 1, winners: p.winners, amount: p.amount };
    }
    const typeMap = new Map(types.map((t) => [t.round, t]));
    return rows.map((r) => {
      const t = typeMap.get(r.round);
      return {
        round: r.round,
        date: r.draw_date,
        numbers: [r.n1, r.n2, r.n3, r.n4, r.n5, r.n6] as Draw['numbers'],
        bonus: r.bonus,
        prizes: prizeMap.get(r.round) ?? ([1, 2, 3, 4, 5] as const).map((rank) => ({ rank, winners: 0, amount: 0 })),
        totalSales: r.total_sales,
        prizePool: r.prize_pool,
        firstWinType: { unknown: t?.unknown ?? 0, auto: t?.auto ?? 0, manual: t?.manual ?? 0, semiAuto: t?.semi_auto ?? 0 },
      };
    });
  }

  /**
   * 회차 저장. 우선순위: api > seed > manual
   *  - api는 기존 seed/manual을 덮어씀 (공식 데이터가 최종)
   *  - seed·manual은 이미 있는 회차를 건드리지 않음
   * @returns 새로 추가된 회차 수
   */
  async upsertDraws(items: { draw: Draw; raw?: RawDraw }[], source: DrawSource, now = new Date()): Promise<number> {
    if (items.length === 0) return 0;
    const existing = new Set((await this.db.all<{ round: number }>('SELECT round FROM draws')).map((r) => r.round));
    const stmts: SqlStatement[] = [];
    const at = now.toISOString();
    let added = 0;
    for (const { draw: d, raw } of items) {
      const errs = validateDraw(d);
      if (errs.length) throw new Error(`${d.round}회 저장 거부: ${errs.join(', ')}`);
      const isNew = !existing.has(d.round);
      if (!isNew && source !== 'api') continue;
      if (isNew) added++;
      const vals: SqlValue[] = [d.round, d.date, ...d.numbers, d.bonus, d.totalSales, d.prizePool, source, raw ? JSON.stringify(raw) : null, at];
      stmts.push({
        sql: `INSERT INTO draws (round, draw_date, n1, n2, n3, n4, n5, n6, bonus, total_sales, prize_pool, source, raw_json, fetched_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(round) DO UPDATE SET draw_date=excluded.draw_date, n1=excluded.n1, n2=excluded.n2, n3=excluded.n3,
                n4=excluded.n4, n5=excluded.n5, n6=excluded.n6, bonus=excluded.bonus, total_sales=excluded.total_sales,
                prize_pool=excluded.prize_pool, source=excluded.source, raw_json=excluded.raw_json, fetched_at=excluded.fetched_at`,
        params: vals,
      });
      for (const p of d.prizes) {
        stmts.push({
          sql: 'INSERT INTO prizes (round, rank, winners, amount) VALUES (?, ?, ?, ?) ON CONFLICT(round, rank) DO UPDATE SET winners=excluded.winners, amount=excluded.amount',
          params: [d.round, p.rank, p.winners, p.amount],
        });
      }
      const t = d.firstWinType;
      stmts.push({
        sql: `INSERT INTO first_win_type (round, auto, manual, semi_auto, unknown) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(round) DO UPDATE SET auto=excluded.auto, manual=excluded.manual, semi_auto=excluded.semi_auto, unknown=excluded.unknown`,
        params: [d.round, t.auto, t.manual, t.semiAuto, t.unknown],
      });
    }
    await this.db.batch(stmts);
    return added;
  }

  async upsertRaw(raws: RawDraw[], now = new Date()): Promise<number> {
    return this.upsertDraws(raws.map((raw) => ({ draw: normalizeDraw(raw), raw })), 'api', now);
  }

  async getRawDraws(): Promise<RawDraw[]> {
    const rows = await this.db.all<{ raw_json: string }>('SELECT raw_json FROM draws WHERE raw_json IS NOT NULL ORDER BY round');
    return rows.map((r) => JSON.parse(r.raw_json) as RawDraw);
  }

  // ───────── 수집 기록 ─────────

  async logFetch(e: Omit<FetchLogEntry, 'attemptedAt'>, now = new Date()): Promise<void> {
    await this.db.run('INSERT INTO fetch_log (attempted_at, target_round, status, added, message) VALUES (?, ?, ?, ?, ?)', [
      now.toISOString(), e.targetRound, e.status, e.added, e.message,
    ]);
  }

  async recentFetchLog(limit = 20): Promise<FetchLogEntry[]> {
    const rows = await this.db.all<{ attempted_at: string; target_round: number; status: FetchStatus; added: number; message: string | null }>(
      'SELECT attempted_at, target_round, status, added, message FROM fetch_log ORDER BY id DESC LIMIT ?',
      [limit],
    );
    return rows.map((r) => ({ attemptedAt: r.attempted_at, targetRound: r.target_round, status: r.status, added: r.added, message: r.message }));
  }

  // ───────── 분석 캐시 ─────────

  async getCache(lastRound: number, version: number): Promise<string | null> {
    const rows = await this.db.all<{ result_json: string }>(
      'SELECT result_json FROM analysis_cache WHERE id = 1 AND last_round = ? AND version = ?',
      [lastRound, version],
    );
    return rows[0]?.result_json ?? null;
  }

  async setCache(lastRound: number, version: number, iterations: number, json: string, now = new Date()): Promise<void> {
    await this.db.run(
      `INSERT INTO analysis_cache (id, last_round, version, iterations, computed_at, result_json) VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_round=excluded.last_round, version=excluded.version, iterations=excluded.iterations,
         computed_at=excluded.computed_at, result_json=excluded.result_json`,
      [lastRound, version, iterations, now.toISOString(), json],
    );
  }

  // ───────── 추천 이력 ─────────

  /** 회차별 기본 추천을 한 번만 기록 (이미 있으면 유지 → 사후 검증이 공정하도록) */
  async saveRecommendations(
    targetRound: number,
    seed: number,
    picks: { numbers: number[] }[],
    now = new Date(),
    strategy: 'default' | 'hot' = 'default',
  ): Promise<void> {
    const base = strategy === 'hot' ? 100 : 0;
    await this.db.batch(
      picks.map((p, idx) => ({
        sql: `INSERT OR IGNORE INTO recommendations (target_round, idx, seed, n1, n2, n3, n4, n5, n6, multiplier, ev_low, ev, ev_high, created_at, strategy)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        // multiplier·ev 열은 예전 인기도 모형 시절 값 — 지금은 0으로 기록
        params: [targetRound, base + idx, seed, ...p.numbers, 0, 0, 0, 0, now.toISOString(), strategy],
      })),
    );
  }

  /** 추첨 결과가 나온 회차의 추천을 채점. @returns 채점한 게임 수 */
  async evaluateRecommendations(): Promise<number> {
    const pending = await this.db.all<{ target_round: number; idx: number; n1: number; n2: number; n3: number; n4: number; n5: number; n6: number }>(
      `SELECT r.target_round, r.idx, r.n1, r.n2, r.n3, r.n4, r.n5, r.n6 FROM recommendations r
       JOIN draws d ON d.round = r.target_round WHERE r.matched IS NULL`,
    );
    if (pending.length === 0) return 0;
    const draws = new Map((await this.getDraws()).map((d) => [d.round, d]));
    const stmts = pending.map((p) => {
      const d = draws.get(p.target_round)!;
      const { matched: m, rank } = grade([p.n1, p.n2, p.n3, p.n4, p.n5, p.n6], d.numbers, d.bonus);
      return { sql: 'UPDATE recommendations SET matched = ?, prize_rank = ? WHERE target_round = ? AND idx = ?', params: [m, rank, p.target_round, p.idx] };
    });
    await this.db.batch(stmts);
    return stmts.length;
  }

  async listRecommendations(limit = 50): Promise<StoredRecommendation[]> {
    const rows = await this.db.all<Record<string, number | string | null>>(
      'SELECT * FROM recommendations ORDER BY target_round DESC, idx LIMIT ?',
      [limit],
    );
    return rows.map((r) => ({
      targetRound: r.target_round as number,
      idx: r.idx as number,
      strategy: (r.strategy as 'default' | 'hot') ?? 'default',
      numbers: [r.n1, r.n2, r.n3, r.n4, r.n5, r.n6] as number[],
      createdAt: r.created_at as string,
      matched: r.matched as number | null,
      prizeRank: r.prize_rank as number | null,
    }));
  }

  // ───────── 구매 기록 (용지 QR) ─────────

  /** 용지 저장. 이미 저장된 용지면 0. 추첨이 끝난 회차면 바로 채점 */
  async savePurchase(ticket: Ticket, now = new Date()): Promise<number> {
    const before = (await this.db.all<{ c: number }>('SELECT COUNT(*) AS c FROM purchases WHERE ticket_key = ?', [ticket.key]))[0].c;
    await this.db.batch(
      ticket.games.map((g) => ({
        sql: `INSERT OR IGNORE INTO purchases (ticket_key, slot, target_round, mode, n1, n2, n3, n4, n5, n6, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [ticket.key, g.slot, ticket.round, g.mode, ...g.numbers, now.toISOString()],
      })),
    );
    await this.evaluatePurchases();
    return before ? 0 : ticket.games.length;
  }

  /** 당첨금 수령 표시 (당첨된 게임만). @returns 바뀐 게임 수 */
  async setClaimed(ticketKey: string, slot: number, claimed: boolean, now = new Date()): Promise<number> {
    const rows = await this.db.all<{ c: number }>('SELECT COUNT(*) AS c FROM purchases WHERE ticket_key = ? AND slot = ? AND prize_rank > 0', [ticketKey, slot]);
    if (!rows[0].c) return 0;
    await this.db.run('UPDATE purchases SET claimed_at = ? WHERE ticket_key = ? AND slot = ?', [claimed ? now.toISOString() : null, ticketKey, slot]);
    return 1;
  }

  async deletePurchase(ticketKey: string): Promise<number> {
    const n = (await this.db.all<{ c: number }>('SELECT COUNT(*) AS c FROM purchases WHERE ticket_key = ?', [ticketKey]))[0].c;
    await this.db.run('DELETE FROM purchases WHERE ticket_key = ?', [ticketKey]);
    return n;
  }

  /** 추첨 결과가 나온 회차의 구매를 채점 (당첨금 = 그 회차 등수별 1인 당첨금). @returns 채점한 게임 수 */
  async evaluatePurchases(): Promise<number> {
    const pending = await this.db.all<{ ticket_key: string; slot: number; target_round: number; n1: number; n2: number; n3: number; n4: number; n5: number; n6: number }>(
      `SELECT p.ticket_key, p.slot, p.target_round, p.n1, p.n2, p.n3, p.n4, p.n5, p.n6 FROM purchases p
       JOIN draws d ON d.round = p.target_round WHERE p.matched IS NULL`,
    );
    if (pending.length === 0) return 0;
    const draws = new Map((await this.getDraws()).map((d) => [d.round, d]));
    const stmts = pending.map((p) => {
      const d = draws.get(p.target_round)!;
      const { matched, rank } = grade([p.n1, p.n2, p.n3, p.n4, p.n5, p.n6], d.numbers, d.bonus);
      const amount = rank ? d.prizes[rank - 1].amount : 0;
      return {
        sql: 'UPDATE purchases SET matched = ?, prize_rank = ?, prize_amount = ? WHERE ticket_key = ? AND slot = ?',
        params: [matched, rank, amount, p.ticket_key, p.slot],
      };
    });
    await this.db.batch(stmts);
    return stmts.length;
  }

  async listPurchases(limit = 500): Promise<StoredPurchase[]> {
    const rows = await this.db.all<Record<string, number | string | null>>(
      'SELECT * FROM purchases ORDER BY target_round DESC, created_at DESC, slot LIMIT ?',
      [limit],
    );
    return rows.map((r) => ({
      ticketKey: r.ticket_key as string,
      slot: r.slot as number,
      targetRound: r.target_round as number,
      mode: r.mode as GameMode,
      numbers: [r.n1, r.n2, r.n3, r.n4, r.n5, r.n6] as number[],
      createdAt: r.created_at as string,
      matched: r.matched as number | null,
      prizeRank: r.prize_rank as number | null,
      prizeAmount: r.prize_amount as number | null,
      claimedAt: r.claimed_at as string | null,
    }));
  }
}
