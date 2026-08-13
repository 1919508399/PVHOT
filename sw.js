/* PV HOT offline shell: keep the app usable on the next open without blocking updates. */
const CACHE_NAME = 'pvhot-shell-v3';
const SHELL = [
  './',
  './index.html',
  './styles.css?v=20260813-v58',
  './app.js?v=20260813-v58',
  './manifest.webmanifest',
  './data_bootstrap.json',
  './site_texts.json?v=20260727-v55',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  const isData = /(?:data|site_texts)_(?:bootstrap|fallback)|data\.json|site_texts\.json/.test(new URL(request.url).pathname);
  event.respondWith(
    (isData ? fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }) : caches.match(request).then((cached) => cached || fetch(request)))
      .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
  );
});
