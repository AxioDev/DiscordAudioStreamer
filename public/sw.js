const CACHE_NAME = 'libre-antenne-pwa-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/site.webmanifest',
  '/offline.html',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname === '/stream' || url.pathname === '/events') {
      return;
    }

    if (request.mode === 'navigate') {
      event.respondWith(
        fetch(request)
          .then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return response;
          })
          .catch(() =>
            caches.match(request).then((cached) => cached || caches.match('/offline.html'))
          )
      );
      return;
    }

    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          return cached;
        }

        return fetch(request)
          .then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return response;
          })
          .catch(() => caches.match('/offline.html'));
      })
    );
    return;
  }

  event.respondWith(
    fetch(request).catch(() => caches.match('/offline.html'))
  );
});
