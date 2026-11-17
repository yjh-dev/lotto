import type { CapacitorConfig } from '@capacitor/cli';

/**
 * 휴대폰 APK 설정 — 웹 화면(dist-app)을 그대로 감싼 앱
 * API 주소는 빌드 시 VITE_API_BASE로 넣음 (npm run build:app)
 */
const config: CapacitorConfig = {
  appId: 'local.lotto.stats',
  appName: '로또 통계',
  webDir: 'dist-app',
  android: {
    // 맥북 서버는 HTTPS(Tailscale 인증서)만 사용 → 평문 HTTP 허용 안 함
    allowMixedContent: false,
  },
};

export default config;
