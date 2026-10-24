// Repeat visits without the wait: versioned assets (atlas sheets and chapter pack pages, ?v=<hash>)
// come from this cache with no request at all, and sounds come from it at once while a fresh copy is
// fetched behind them. Everything else (pages, js, the sprite tables, /api) goes to the network as it
// did without a worker, so a deploy never mixes an old table with new sheets.
const CACHE = 'drsim-assets-1';
const AUDIO = /\.(ogg|mp3|wav|m4a)$/i;

self.addEventListener('install', (e) => {
  // (Chromium) the page, its code and /api never wait for this worker to start: only /assets/ comes here
  if (e.addRoutes) {
    try { e.waitUntil(e.addRoutes([{ condition: { requestMode: 'navigate' }, source: 'network' }, { condition: { urlPattern: '/js/*' }, source: 'network' }, { condition: { urlPattern: '/api/*' }, source: 'network' }]).catch(() => { })); } catch (err) { }
  }
  self.skipWaiting();
});
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith('/assets/')) return;
  if (url.searchParams.has('v') && !url.searchParams.has('retry')) e.respondWith(versioned(req, url, e));
  else if (AUDIO.test(url.pathname)) e.respondWith(audio(req, e));
});

// The response goes to the page at once; the cache is written behind it. (Waiting for the write, and
// listing the whole cache after each one, held every sheet back: a minute for the 105 sheets on WebKit.)
async function versioned(req, url, e) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.status === 200) {
    const copy = res.clone();
    e.waitUntil(c.put(req, copy).then(() => { fresh.set(url.pathname, url.search); return prune(); }).catch(() => { }));
  }
  return res;
}

// the same file under an older version is dead weight now: one pass over the cache for a batch of new files
const fresh = new Map();
let pruning = null;
function prune() {
  if (pruning) return pruning;
  pruning = new Promise((r) => setTimeout(r, 3000)).then(async () => {
    const c = await caches.open(CACHE), done = new Map(fresh);
    for (const k of await c.keys()) { const u = new URL(k.url), s = done.get(u.pathname); if (s !== undefined && u.search !== s) await c.delete(k); }
    for (const [p, s] of done) if (fresh.get(p) === s) fresh.delete(p);
  }).finally(() => { pruning = null; if (fresh.size) prune(); });
  return pruning;
}

async function audio(req, e) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req, { ignoreSearch: true });
  const net = fetch(req);
  const save = net.then((res) => (res.ok && res.status === 200 ? c.put(req, res.clone()) : null));
  e.waitUntil(save.catch(() => { }));
  return hit || net;
}
