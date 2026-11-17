/**
 * 휴대폰 앱 배포 — npm run apk
 *   1. android/app/build.gradle의 versionCode +1, versionName 1.N
 *   2. 앱용 웹 빌드(API 주소·버전 포함) → Capacitor 동기화 → Gradle 디버그 빌드
 *   3. release/lotto.apk + release/app.json 갱신 → 맥북 서버가 /lotto.apk, /api/app으로 제공
 *      → 휴대폰 앱이 새 버전을 알아채고 "받기" 버튼을 띄움
 */
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RELEASE_DIR, ROOT } from '../server/paths.ts';

const API_BASE = 'https://<맥북>.<tailnet>.ts.net:8443/api';
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
console.log(`\n앱 ${name} (versionCode ${code}) 배포: ${apk}\n휴대폰: 앱의 "새 버전" 버튼 또는 https://<맥북>.<tailnet>.ts.net:8443/lotto.apk`);
