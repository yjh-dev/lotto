/**
 * 맥북 API 서버 실행
 *   npm run server
 *
 * HOST: 쉼표로 여러 주소 지정 가능. 기본 127.0.0.1 (이 맥북 안에서만).
 * 휴대폰 접속: `tailscale serve --bg --https=8443 http://127.0.0.1:8645`
 *   → https://<맥북>.<tailnet>.ts.net:8443  (Tailscale 기기만, Let's Encrypt 인증서 자동 갱신)
 *   443이 아닌 8443인 이유: 이 맥북의 Apache(httpd)가 *:443을 사용 중이라 충돌.
 *   Serve 없이 직접 열려면 HOST=127.0.0.1,<맥북 Tailscale IP> (HTTP, WireGuard로 암호화됨).
 */
import { openNodeDb } from '../src/db/node-db.ts';
import { LottoRepository } from '../src/db/repository.ts';
import { createApp } from './app.ts';
import { DB_PATH, DIST_DIR, RELEASE_DIR } from './paths.ts';

const HOSTS = (process.env.HOST ?? '127.0.0.1').split(',').map((h) => h.trim()).filter(Boolean);
const PORT = Number(process.env.PORT ?? 8645);

const repo = new LottoRepository(openNodeDb(DB_PATH));
await repo.init();
const last = await repo.lastRound();

for (const host of HOSTS) {
  const server = createApp(repo, { distDir: DIST_DIR, releaseDir: RELEASE_DIR, backup: true });
  server.on('error', (e) => {
    // 부팅 직후 Tailscale 주소가 아직 없을 수 있음 → 종료하면 launchd(KeepAlive)가 잠시 후 다시 실행
    console.error(`${new Date().toISOString()} ✗ ${host}:${PORT} 열기 실패: ${e.message}`);
    process.exit(1);
  });
  server.listen(PORT, host, () => console.log(`${new Date().toISOString()} 로또 서버 http://${host}:${PORT} (DB ${last}회까지)`));
}
