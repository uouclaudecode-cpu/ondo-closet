// bary service worker: keeps the app shell available offline.
// The page and config are network-first (so a new version shows up on the next open);
// icons and CDN libraries/fonts are served from cache and refreshed in the background.
// Supabase, weather and AI calls are never cached.
const VERSION = "bary-v1";
const SHELL = ["./", "index.html", "config.js", "manifest.json", "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
const CDN = /^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) || (req.mode === "navigate" ? cache.match("index.html") : Response.error());
  }
}
async function staleWhileRevalidate(req) {
  const cache = await caches.open(VERSION), hit = await cache.match(req);
  const fresh = fetch(req).then(res => { if (res.ok || res.type === "opaque") cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || fresh;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    const page = req.mode === "navigate" || /\/(index\.html|config\.js|manifest\.json)?$/.test(url.pathname) || url.pathname.endsWith(".html") || url.pathname.endsWith("config.js");
    e.respondWith(page ? networkFirst(req) : staleWhileRevalidate(req));
  } else if (CDN.test(req.url)) {
    e.respondWith(staleWhileRevalidate(req));
  }
});
