/* Food Memory Service Worker
 * - インストール時に index.html と、そこから参照されるビルド成果物をまとめてキャッシュ
 * - ページ遷移: ネットワーク優先（3秒でタイムアウト）→ 失敗時はキャッシュ
 * - 静的ファイル: キャッシュ優先
 * 記録データ・写真は IndexedDB に保存され、この SW は関与しません。
 */
const VERSION = 'mvpf0wrw';
const CACHE = `food-memory-${VERSION}`;
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(CORE.map((u) => new Request(u, { cache: 'reload' })));
      // index.html が参照する JS / CSS（ハッシュ付きファイル名）も事前にキャッシュする
      const res = await cache.match('./index.html');
      if (res) {
        const html = await res.clone().text();
        const urls = new Set();
        const re = /(?:src|href)=["'](\.?\/?assets\/[^"']+)["']/g;
        let m;
        while ((m = re.exec(html))) urls.add(m[1]);
        await cache.addAll([...urls].map((u) => new Request(u, { cache: 'reload' })));
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('food-memory-') && k !== CACHE).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

function fetchWithTimeout(request, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(request, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function handleNavigation(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetchWithTimeout(request, 3000);
    if (res && res.ok) cache.put('./index.html', res.clone());
    return res;
  } catch {
    const cached = (await cache.match('./index.html')) || (await cache.match('./'));
    return cached || new Response('オフラインです', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function handleAsset(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(req.mode === 'navigate' ? handleNavigation(req) : handleAsset(req));
});
