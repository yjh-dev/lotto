import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5180,
    strictPort: true,
    // 로컬 개발: 화면(5180) → 맥북 API 서버(8645). 휴대폰·APK는 tailscale serve 주소로 직접 접속
    proxy: {
      '/api': { target: 'http://127.0.0.1:8645', changeOrigin: true },
    },
  },
});
