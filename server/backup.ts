/**
 * DB 백업 — 데이터가 바뀐 직후에만: 토요일 추첨 후 새 회차 수집 · 용지 QR 저장
 *   SQLite VACUUM INTO로 실행 중인 DB의 일관된 사본을 만들고, 최근 KEEP개만 남김
 *
 * 저장 위치: iCloud Drive(BACKUP_DIR) 우선. 백그라운드(launchd)에서 iCloud 폴더는 macOS 권한이 필요해
 * 멈출 수 있으므로 별도 프로세스로 실행하고, 시간 안에 안 끝나면 맥북 안의 LOCAL_BACKUP_DIR에 저장.
 *
 *   npm run backup   지금 바로 백업 (같은 방식)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openNodeDb } from '../src/db/node-db.ts';
import { BACKUP_DIR, DB_PATH, LOCAL_BACKUP_DIR } from './paths.ts';

const KEEP = 10;
const TIMEOUT_MS = 20_000;

/** 같은 프로세스에서 백업 (iCloud 권한이 없으면 여기서 멈출 수 있음 → backupSafely 사용) */
export function backupTo(dir: string, dbPath = DB_PATH, now = new Date()): string {
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const file = join(dir, `lotto-${stamp}.db`);
  rmSync(file, { force: true });
  const db = openNodeDb(dbPath);
  try {
    void db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  } finally {
    void db.close();
  }
  for (const f of readdirSync(dir).filter((f) => /^lotto-\d{12}\.db$/.test(f)).sort().slice(0, -KEEP)) rmSync(join(dir, f));
  return file;
}

function runChild(dir: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', dir], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 && out.trim() ? out.trim() : null);
    });
  });
}

/** iCloud → 실패하면 로컬. 서버·수집기를 막지 않음 */
export async function backupSafely(reason: string): Promise<string | null> {
  const file = (await runChild(BACKUP_DIR)) ?? (await runChild(LOCAL_BACKUP_DIR));
  console.log(new Date().toISOString(), file ? `백업(${reason}): ${file} (${(statSync(file).size / 1024).toFixed(0)}KB)` : `⚠ 백업 실패(${reason})`);
  return file;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2] === '--child') process.stdout.write(backupTo(process.argv[3]));
  else await backupSafely('수동');
}
