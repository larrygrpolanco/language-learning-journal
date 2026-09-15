/*
 * The service worker. Technical plan §1 and M5.
 *
 * §1 permits "no service worker doing anything but caching the shell", and that is the whole of what
 * this does. There is no background sync, no push, no periodic sync, no queue of failed writes, and
 * nothing that runs when the app is closed. The journal already works offline because it lives in
 * IndexedDB; this only makes the shell load without a network.
 *
 * Hand-written rather than generated. A build-time precache manifest would need a plugin and would
 * list hashed filenames, and the cache-on-first-use approach below gets the same result: once a screen
 * has been visited online, it opens offline.
 *
 * Two rules keep it honest:
 *
 *  - Same-origin GET only. Calls to api.x.ai are never cached, never replayed, and never intercepted.
 *    An AI call is something the learner just pressed (§9), and a stale cached answer would be a lie.
 *  - Navigations fall back to the cached shell, because this is a single-page app and every route is
 *    served by the same index.html.
 */

const CACHE = 'llj-shell-v1'

// The shell itself. Hashed assets are not listed, and are cached the first time they are fetched.
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // Individually, so one missing file cannot fail the whole install.
      await Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined)))
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // Anything off this origin is left entirely alone. That is the xAI API, and it must not be cached.
  if (url.origin !== self.location.origin) return

  // A navigation is always the same shell. Network first so a deployed change is picked up, falling
  // back to the cached shell when there is nothing to reach.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request)
        } catch {
          const cache = await caches.open(CACHE)
          return (
            (await cache.match('./index.html')) ??
            (await cache.match('./')) ??
            Response.error()
          )
        }
      })(),
    )
    return
  }

  // Everything else: cache first, because Vite's asset filenames carry a content hash, so a cached
  // one can never be the wrong version. A miss is fetched and kept for next time.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const hit = await cache.match(request)
      if (hit) return hit

      try {
        const response = await fetch(request)
        if (response.ok && response.type === 'basic') {
          cache.put(request, response.clone()).catch(() => undefined)
        }
        return response
      } catch (e) {
        // Offline and never seen. Nothing to serve, and pretending otherwise would be worse.
        throw e
      }
    })(),
  )
})
