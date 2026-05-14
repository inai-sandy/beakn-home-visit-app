// Beakn Home Visit — service worker (HVA-19).
//
// Strategies:
//   - precache: app shell + manifest + icons on install
//   - /api/*           : network-first (no stale API data; fall back to cache only if offline)
//   - /_next/static/*  : cache-first (immutable build assets, content-hashed by Next)
//   - same-origin GETs : stale-while-revalidate (serve fast, refresh in background)
//   - everything else  : passthrough to network
//
// Bump CACHE_VERSION when the precached shell needs a fresh fetch. Old caches
// are pruned in the activate event.
//
// NOT included (deferred):
//   - push handlers — HVA-54 owns Web Push subscription + onpush/onnotificationclick.

const CACHE_VERSION = 'beakn-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Conservative precache: only assets whose URLs are stable across builds.
// Next.js JS/CSS chunks are content-hashed; they'd invalidate every deploy.
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/favicon.ico',
  '/icon-192x192.png',
  '/icon-512x512.png',
  '/icon-512x512-maskable.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        // Use addAll-equivalent that doesn't fail the whole install if one URL 404s.
        Promise.all(
          PRECACHE_URLS.map((url) =>
            fetch(url, { cache: 'reload' })
              .then((res) => {
                if (res.ok) return cache.put(url, res);
              })
              .catch(() => undefined),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GETs. POST/PUT/DELETE etc. always pass through.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Cross-origin (Google Fonts, Material Symbols, etc.) — let the browser handle it.
  if (url.origin !== self.location.origin) return;

  // /api/* — network-first, fall back to cache if offline.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // /_next/static/* — content-hashed immutables, cache-first.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Everything else same-origin — stale-while-revalidate.
  event.respondWith(staleWhileRevalidate(req));
});

async function networkFirst(req) {
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const fresh = await fetch(req);
  if (fresh && fresh.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(req, fresh.clone());
  }
  return fresh;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return cached ?? (await network) ?? Response.error();
}
