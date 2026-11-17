/**
 * 데이터베이스 스키마와 마이그레이션.
 * 버전을 올릴 때는 MIGRATIONS 배열 끝에 추가만 한다 (기존 항목 수정 금지).
 */
import type { SqlDb } from './sql.ts';

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE draws (
    round        INTEGER PRIMARY KEY,
    draw_date    TEXT    NOT NULL,
    n1 INTEGER NOT NULL, n2 INTEGER NOT NULL, n3 INTEGER NOT NULL,
    n4 INTEGER NOT NULL, n5 INTEGER NOT NULL, n6 INTEGER NOT NULL,
    bonus        INTEGER NOT NULL,
    total_sales  INTEGER NOT NULL DEFAULT 0,
    prize_pool   INTEGER NOT NULL DEFAULT 0,
    source       TEXT    NOT NULL CHECK (source IN ('seed', 'api', 'manual')),
    raw_json     TEXT,
    fetched_at   TEXT    NOT NULL
  );
  CREATE TABLE prizes (
    round    INTEGER NOT NULL REFERENCES draws(round) ON DELETE CASCADE,
    rank     INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 5),
    winners  INTEGER NOT NULL,
    amount   INTEGER NOT NULL,
    PRIMARY KEY (round, rank)
  );
  CREATE TABLE first_win_type (
    round      INTEGER PRIMARY KEY REFERENCES draws(round) ON DELETE CASCADE,
    auto       INTEGER NOT NULL DEFAULT 0,
    manual     INTEGER NOT NULL DEFAULT 0,
    semi_auto  INTEGER NOT NULL DEFAULT 0,
    unknown    INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE fetch_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    attempted_at  TEXT    NOT NULL,
    target_round  INTEGER NOT NULL,
    status        TEXT    NOT NULL CHECK (status IN ('added', 'up-to-date', 'not-yet', 'failed')),
    added         INTEGER NOT NULL DEFAULT 0,
    message       TEXT
  );
  CREATE INDEX fetch_log_target ON fetch_log(target_round, attempted_at);
  CREATE TABLE analysis_cache (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    last_round   INTEGER NOT NULL,
    version      INTEGER NOT NULL,
    iterations   INTEGER NOT NULL,
    computed_at  TEXT    NOT NULL,
    result_json  TEXT    NOT NULL
  );
  CREATE TABLE recommendations (
    target_round  INTEGER NOT NULL,
    idx           INTEGER NOT NULL,
    seed          INTEGER NOT NULL,
    n1 INTEGER NOT NULL, n2 INTEGER NOT NULL, n3 INTEGER NOT NULL,
    n4 INTEGER NOT NULL, n5 INTEGER NOT NULL, n6 INTEGER NOT NULL,
    multiplier    REAL    NOT NULL,
    ev_low        REAL    NOT NULL,
    ev            REAL    NOT NULL,
    ev_high       REAL    NOT NULL,
    created_at    TEXT    NOT NULL,
    matched       INTEGER,
    prize_rank    INTEGER,
    PRIMARY KEY (target_round, idx)
  );
  `,
  // v2 — 실제 구매 번호 (용지 QR). ticket_key = QR의 v 값 → 같은 용지를 다시 스캔해도 중복 저장 안 됨
  `
  CREATE TABLE purchases (
    ticket_key    TEXT    NOT NULL,
    slot          INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 4),
    target_round  INTEGER NOT NULL,
    mode          TEXT    NOT NULL,
    n1 INTEGER NOT NULL, n2 INTEGER NOT NULL, n3 INTEGER NOT NULL,
    n4 INTEGER NOT NULL, n5 INTEGER NOT NULL, n6 INTEGER NOT NULL,
    created_at    TEXT    NOT NULL,
    matched       INTEGER,
    prize_rank    INTEGER,
    prize_amount  INTEGER,
    PRIMARY KEY (ticket_key, slot)
  );
  CREATE INDEX purchases_round ON purchases (target_round);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export async function migrate(db: SqlDb): Promise<number> {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const rows = await db.all<{ version: number }>('SELECT version FROM schema_version');
  const current = rows[0]?.version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    await db.exec(MIGRATIONS[v]);
    await db.run(rows.length || v > current ? 'UPDATE schema_version SET version = ?' : 'INSERT INTO schema_version (version) VALUES (?)', [v + 1]);
    rows.length = 1;
  }
  return MIGRATIONS.length;
}
