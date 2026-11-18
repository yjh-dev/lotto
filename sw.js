/**
 * 웹앱(iPhone 홈 화면) 오프라인 캐시
 *  - 화면(index.html): 네트워크 먼저 → 새 버전을 바로 반영, 안 되면 캐시
 *  - 빌드 파일(이름에 해시가 붙은 js·css·폰트)·아이콘: 캐시 먼저
 *  - 당첨번호 데이터(다른 주소)는 건드리지 않음 → 앱이 직접 받아 기기에 저장
 */
const CACHE = 'lotto-web-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./', copy));
          return res;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
