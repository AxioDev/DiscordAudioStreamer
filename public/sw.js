const CACHE_VERSION = 'v2';
const CACHE_NAME = `libre-antenne-pwa-${CACHE_VERSION}`;
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

self.addEventListener('message', (event) => {
  if (!event || !event.data) {
    return;
  }

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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

  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
    return;
  }

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname === '/stream' || url.pathname === '/events') {
      return;
    }

    if (request.mode === 'navigate') {
      event.respondWith(networkFirst(request, { fallbackToOffline: true }));
      return;
    }

    const shouldFallbackToOffline = request.destination === 'document';
    event.respondWith(networkFirst(request, { fallbackToOffline: shouldFallbackToOffline }));
    return;
  }

  event.respondWith(
    fetch(request).catch(() => caches.match('/offline.html'))
  );
});

function shouldCacheResponse(response) {
  if (!response || !response.ok) {
    return false;
  }

  const cacheControl = response.headers.get('Cache-Control');
  if (cacheControl && /no-store|no-cache|private/i.test(cacheControl)) {
    return false;
  }

  return response.type === 'basic' || response.type === 'cors';
}

async function networkFirst(request, { fallbackToOffline = false } = {}) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (shouldCacheResponse(response)) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    if (fallbackToOffline) {
      const offline = await cache.match('/offline.html');
      if (offline) {
        return offline;
      }
    }

    return new Response('', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
