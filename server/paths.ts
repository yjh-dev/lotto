import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 맥북의 원본 DB */
export const DB_PATH = process.env.LOTTO_DB ?? resolve(ROOT, 'data/lotto.db');
/** 앱 빌드에 포함되는 초기 데이터 (DB에서 내보냄) */
export const SEED_JSON = resolve(ROOT, 'data/draws.json');
/** API 원본 응답 백업 (DB에서 내보냄) */
export const RAW_JSON = resolve(ROOT, 'data/raw-draws.json');
/** 빌드된 웹 화면 */
export const DIST_DIR = resolve(ROOT, 'dist');
/** DB 백업 폴더 (iCloud Drive — 맥북 디스크가 망가져도 남도록) */
export const BACKUP_DIR =
  process.env.LOTTO_BACKUP_DIR ?? resolve(process.env.HOME ?? ROOT, 'Library/Mobile Documents/com~apple~CloudDocs/lotto-backup');
/** 휴대폰이 받아 갈 최신 APK와 버전 정보 (npm run apk가 갱신) */
export const RELEASE_DIR = resolve(ROOT, 'release');
/** iCloud에 못 쓸 때(권한) 대신 쓰는 맥북 안 백업 폴더 */
export const LOCAL_BACKUP_DIR = resolve(process.env.HOME ?? ROOT, 'lotto-backups');
