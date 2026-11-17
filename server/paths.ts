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
