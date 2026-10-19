/* Smart RV — Service Worker (mode hors-ligne)
   - Pré-cache l'app + les 5 bibliothèques CDN au premier lancement EN LIGNE.
   - Ensuite tout fonctionne sans connexion (cache d'abord).
   - Mise à jour MANUELLE uniquement : bouton « Vérifier les mises à jour » (message CHECK_FOR_UPDATE). */
const CACHE = 'smartrv-cache-v46';
const CORE = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './sidikacem-map.json'];
const CDN = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];
const TILES = 'smartrv-tiles-v1';
const CDN_HOSTS = ['cdn.tailwindcss.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(CORE.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    await Promise.allSettled(CDN.map(async (u) => {
      if (await cache.match(u)) return;
      const res = await fetch(new Request(u, { mode: 'no-cors' }));
      await cache.put(u, res);
    }));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE && k !== TILES).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  if (url.hostname === 'tile.openstreetmap.org' || url.hostname.endsWith('.tile.openstreetmap.org')) { event.respondWith(tile(req)); return; }
  if (!same && !CDN_HOSTS.includes(url.hostname)) return; // tuiles de carte, etc. : le réseau gère
  if (req.mode === 'navigate') { event.respondWith(navigate(req)); return; }
  event.respondWith(cacheFirst(req, same));
});

async function navigate(req) {
  const cache = await caches.open(CACHE);
  const hit = (await cache.match('./index.html')) || (await cache.match('./'));
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put('./index.html', res.clone());
    return res;
  } catch (_) {
    return new Response('<meta charset="utf-8"><p style="font:16px sans-serif;padding:24px">Hors ligne : ouvrez d’abord l’app une fois avec internet.</p>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function cacheFirst(req, same) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: same });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  } catch (_) {
    return Response.error();
  }
}

async function checkForUpdate(client) {
  const say = (m) => { try { client && client.postMessage(m); } catch (_) {} };
  try {
    const res = await fetch('./index.html', { cache: 'reload' });
    if (!res.ok) throw new Error('http ' + res.status);
    const cache = await caches.open(CACHE);
    const old = await cache.match('./index.html');
    const fresh = await res.clone().text();
    const prev = old ? await old.text() : '';
    if (fresh === prev) { say('NO_UPDATE'); return; }
    await cache.put('./index.html', res);
    say('UPDATE_READY');
  } catch (_) { say('UPDATE_FAILED'); }
}

self.addEventListener('message', (event) => {
  if (event.data === 'CHECK_FOR_UPDATE') event.waitUntil(checkForUpdate(event.source));
  else if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Tuiles de carte OSM : d'abord le cache (hors ligne), sinon réseau ; seules les réponses valides sont mémorisées.
async function tile(req) {
  const cache = await caches.open(TILES);
  const key = 'https://tile.openstreetmap.org' + new URL(req.url).pathname;
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    const res = await fetch(key, { mode: 'cors' });
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch (_) { return Response.error(); }
}
