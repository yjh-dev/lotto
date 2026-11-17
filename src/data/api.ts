/**
 * 맥북 서버 주소. 개발(Vite)·맥북이 제공하는 웹 화면: 같은 주소의 '/api'.
 * APK: npm run apk가 .env.app(git 제외)의 LOTTO_API_BASE를 VITE_API_BASE로 넣어 빌드 (scripts/release-app.ts)
 * (Node 테스트에서는 import.meta.env가 없음)
 */
const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

export const API_BASE = env.VITE_API_BASE ?? '/api';
/** 새 APK 받는 주소 (API 주소에서 /api를 뺀 곳) */
export const APK_URL = `${API_BASE.replace(/\/api$/, '')}/lotto.apk`;
/** 이 앱의 버전 (APK 빌드 때 넣음, 웹 화면이면 null) */
export const APP_VERSION = env.VITE_APP_VERSION ? Number(env.VITE_APP_VERSION) : null;
export const APP_VERSION_NAME = env.VITE_APP_VERSION_NAME ?? null;
