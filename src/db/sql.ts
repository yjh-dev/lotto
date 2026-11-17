/**
 * SQL 실행 추상화 — 저장소 로직은 이 인터페이스만 사용한다.
 *  - 앱(PC 브라우저·휴대폰): capacitor-db.ts (@capacitor-community/sqlite, 웹은 jeep-sqlite)
 *  - 수집 스크립트·테스트(Node): node-db.ts (내장 node:sqlite)
 */
export type SqlValue = string | number | null;

export interface SqlStatement {
  sql: string;
  params?: SqlValue[];
}

export interface SqlDb {
  /** 여러 문장 실행 (파라미터 없음, 스키마 생성용) */
  exec(sql: string): Promise<void>;
  /** 단일 쓰기 문장 */
  run(sql: string, params?: SqlValue[]): Promise<void>;
  /** 조회 */
  all<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  /** 여러 쓰기 문장을 하나의 트랜잭션으로 (전부 성공 또는 전부 취소) */
  batch(statements: SqlStatement[]): Promise<void>;
  close(): Promise<void>;
}
