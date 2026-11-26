// Core Breakers offline helper. VERSION changes with every build so updates arrive on their own.
const VERSION = 'cb-0c302c3a3e68';
const CORE = ["art/arena_0.webp","art/arena_1.webp","art/arena_2.webp","art/arena_3.webp","art/arena_4.webp","art/blaster_blue.webp","art/blaster_red.webp","art/colossus_blue.webp","art/colossus_red.webp","art/guard_blue.webp","art/guard_red.webp","art/guardx_blue.webp","art/guardx_red.webp","art/hound_blue.webp","art/hound_red.webp","art/jet_blue.webp","art/jet_red.webp","art/king_blue.webp","art/king_red.webp","art/kingx_blue.webp","art/kingx_red.webp","art/medic_blue.webp","art/medic_red.webp","art/rocket_blue.webp","art/rocket_red.webp","art/sentinel_blue.webp","art/sentinel_red.webp","art/spider_blue.webp","art/spider_red.webp","art/titan_blue.webp","art/titan_red.webp","art/turret_blue.webp","art/turret_red.webp","icon-180.png","icon-512.png","index.html","js/battle.js","js/boot.js","js/data.js","js/progress.js","js/sheets.js","js/ui.js","manifest.webmanifest","style.css","./"];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('cb-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
function withTimeout(p, ms) { return Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]); }
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== location.origin) return;
  const code = /\.(html|js|css|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/');
  if (code) {   // network first so updates land; saved copy when offline
    e.respondWith(withTimeout(fetch(req, { cache: 'no-store' }), 4000)
      .then(res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; })));
});
