/**
 * Node 내장 SQLite(node:sqlite) 어댑터 — 수집 스크립트와 테스트 전용.
 * 앱 번들에는 포함하지 않는다 (브라우저에서 node:sqlite 불가).
 */
import { DatabaseSync } from 'node:sqlite';
import type { SqlDb, SqlValue } from './sql.ts';

export function openNodeDb(path = ':memory:'): SqlDb {
  const db = new DatabaseSync(path);
  if (path !== ':memory:') {
    // 수집기(쓰기)와 서버(읽기)가 동시에 열어도 막히지 않도록
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 5000');
  }
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params: SqlValue[] = []) {
      db.prepare(sql).run(...params);
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async batch(statements) {
      db.exec('BEGIN');
      try {
        for (const s of statements) db.prepare(s.sql).run(...(s.params ?? []));
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async close() {
      db.close();
    },
  };
}
