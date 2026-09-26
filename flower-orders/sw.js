// 오프라인에서도 열리도록 앱 파일을 캐시합니다. 파일을 바꾸면 CACHE 버전을 올려 주세요.
const CACHE = 'flower-orders-v13';
const FILES = ['./', './index.html', './styles.css', './parser.js', './app.js', './manifest.json', './icon.svg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 다른 앱에서 "공유 → 꽃 주문함"으로 보낸 글·사진을 잠시 보관했다가 앱 화면으로 넘깁니다.
const SHARE_CACHE = 'flower-share';
async function receiveShare(request) {
  const form = await request.formData();
  const cache = await caches.open(SHARE_CACHE);
  await Promise.all((await cache.keys()).map((k) => cache.delete(k)));
  const text = ['title', 'text', 'url'].map((k) => form.get(k)).filter(Boolean).join('\n');
  if (text) await cache.put('shared/text', new Response(text));
  const files = form.getAll('images').filter((f) => f && f.size);
  await Promise.all(files.map((f, i) => cache.put(`shared/image-${i}`, new Response(f, { headers: { 'content-type': f.type } }))));
  return Response.redirect('./index.html?shared=1', 303);
}

// 네트워크 우선, 실패하면 캐시
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/share')) {
    e.respondWith(receiveShare(e.request).catch(() => Response.redirect('./index.html', 303)));
    return;
  }
  // 앱 파일만 캐시합니다. 서버(주문·메시지) 요청은 건드리지 않습니다.
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
