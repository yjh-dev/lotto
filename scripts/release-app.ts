/**
 * 휴대폰 앱 배포 — npm run apk
 *   1. android/app/build.gradle의 versionCode +1, versionName 1.N
 *   2. 앱용 웹 빌드(API 주소·버전 포함) → Capacitor 동기화 → Gradle 디버그 빌드
 *   3. release/lotto.apk + release/app.json 갱신 → 맥북 서버가 /lotto.apk, /api/app으로 제공
 *      → 휴대폰 앱이 새 버전을 알아채고 "받기" 버튼을 띄움
 */
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RELEASE_DIR, ROOT } from '../server/paths.ts';

/**
 * 휴대폰이 접속할 맥북 서버 주소 — 공개 저장소에 올리지 않도록 .env.app(git 제외)에 둠
 *   LOTTO_API_BASE=https://<맥북>.<tailnet>.ts.net:8443/api
 * 버전 번호를 올리기 전에 확인 → 주소가 없으면 아무것도 바꾸지 않고 멈춤
 */
function apiBase(): string {
  if (process.env.LOTTO_API_BASE) return process.env.LOTTO_API_BASE;
  const file = join(ROOT, '.env.app');
  const m = existsSync(file) ? /^LOTTO_API_BASE=(.+)$/m.exec(readFileSync(file, 'utf8')) : null;
  if (m) return m[1].trim();
  console.error('.env.app에 LOTTO_API_BASE=https://<맥북>.<tailnet>.ts.net:8443/api 를 넣어 주세요');
  process.exit(1);
}
const API_BASE = apiBase();
const gradleFile = join(ROOT, 'android/app/build.gradle');
const gradle = readFileSync(gradleFile, 'utf8');
const code = Number(/versionCode (\d+)/.exec(gradle)![1]) + 1;
const name = `1.${code - 1}`;
writeFileSync(gradleFile, gradle.replace(/versionCode \d+/, `versionCode ${code}`).replace(/versionName "[^"]*"/, `versionName "${name}"`));

const run = (cmd: string, cwd = ROOT, env: Record<string, string> = {}) => execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
run('npx tsc --noEmit');
run('npx vite build --outDir dist-app --emptyOutDir', ROOT, { VITE_API_BASE: API_BASE, VITE_APP_VERSION: String(code), VITE_APP_VERSION_NAME: name });
run('npx cap sync android');
const javaHome = execSync('/usr/libexec/java_home -v 21').toString().trim();
run('./gradlew assembleDebug -q', join(ROOT, 'android'), { JAVA_HOME: javaHome });

mkdirSync(RELEASE_DIR, { recursive: true });
const apk = join(RELEASE_DIR, 'lotto.apk');
copyFileSync(join(ROOT, 'android/app/build/outputs/apk/debug/app-debug.apk'), apk);
writeFileSync(join(RELEASE_DIR, 'app.json'), JSON.stringify({ versionCode: code, versionName: name, size: statSync(apk).size, builtAt: new Date().toISOString() }));
console.log(`\n앱 ${name} (versionCode ${code}) 배포: ${apk}\n휴대폰: 앱의 "새 버전" 버튼 또는 ${API_BASE.replace(/\/api$/, '')}/lotto.apk`);
