// Beakn Service Worker
// Cache version: beakn-v2-hva146 (HVA-146, 2026-05-17)
//
// Strategy:
//   /api/*                          → bypass SW entirely
//   RSC fetches (RSC: 1 / _rsc=)    → bypass SW entirely  [HVA-146]
//   /_next/static/                  → cacheFirst (content-hashed, immutable)
//   everything else same-origin     → networkFirst (fresh, cache as offline fallback)
//
// HVA-146 history: previous version used staleWhileRevalidate for
// "everything else" which poisoned dynamic pages after the first
// mutation. router.refresh()-triggered RSC re-fetches were served
// from cache, masking HVA-136 + HVA-143 fixes. See HVA-146 ticket.
//
// Bump CACHE_VERSION when the precached shell needs a fresh fetch. Old caches
// are pruned in the activate event.
//
// NOT included (deferred):
//   - push handlers — HVA-54 owns Web Push subscription + onpush/onnotificationclick.

const CACHE_VERSION = 'beakn-v2-hva146';
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

  // HVA-146 belt-and-braces: never intercept RSC fetches.
  // RSC fetches are identifiable by the 'RSC: 1' request header or the
  // '_rsc' query parameter. Letting them passthrough to the network
  // ensures router.refresh()-triggered re-fetches always get fresh data,
  // regardless of any other SW caching strategy.
  if (req.headers.get('RSC') === '1' || req.url.includes('_rsc=')) {
    return; // passthrough — browser handles fetch normally, no SW involvement
  }

  // /_next/static/* — content-hashed immutables, cache-first.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Everything else same-origin — network-first (cache as offline fallback only).
  event.respondWith(networkFirst(req));
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

// NOTE: staleWhileRevalidate is currently unused as of HVA-146.
// It was the default strategy for "everything else" but was
// poisoning every dynamic page after the first mutation.
// If a specific path genuinely needs SWR semantics in the future,
// call it explicitly for THAT path only — never as the fallback.
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
