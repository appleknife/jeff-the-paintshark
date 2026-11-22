const CACHE = 'paintshark-v7';
const ASSETS = [
  '.', 'index.html', 'css/app.css',
  'js/main.js', 'js/appstate.js', 'js/util.js', 'js/brush.js', 'js/doc.js', 'js/zip.js',
  'js/selection.js', 'js/transform.js', 'js/adjust.js', 'js/view.js', 'js/store.js',
  'js/timelapse.js', 'js/sheets.js', 'js/studio.js', 'js/studio2.js', 'js/brushstudio.js',
  'js/input.js', 'js/sfx.js', 'manifest.webmanifest', 'icons/logo.png', 'icons/favicon-32.png', 'icons/icon-180.png',
  'icons/icon-512.png', 'icons/icon-maskable-512.png', 'fonts/nunito-latin-wght-normal.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  e.respondWith((async () => {
    try {
      // Network first, but don't hang on a bad connection: fall back to the cache after 4 s.
      const fresh = await Promise.race([
        fetch(e.request, { cache: 'no-cache' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
      ]);
      if (fresh.ok) {
        const copy = fresh.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      }
      return fresh;
    } catch {
      const hit = await caches.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      // Only page navigations fall back to the app shell; a missing script must not get HTML.
      if (e.request.mode === 'navigate') return (await caches.match('index.html')) || Response.error();
      return Response.error();
    }
  })());
});
