// Core Breakers offline helper. VERSION changes with every build so updates arrive on their own.
const VERSION = 'cb-4e188d46baa1';
const CORE = ["art/card_arc.webp","art/card_blaster.webp","art/card_bombard.webp","art/card_bomber.webp","art/card_boombot.webp","art/card_colossus.webp","art/card_cryo.webp","art/card_emp.webp","art/card_hive.webp","art/card_hound.webp","art/card_jet.webp","art/card_medic.webp","art/card_missile.webp","art/card_rail.webp","art/card_rocket.webp","art/card_scorcher.webp","art/card_sentinel.webp","art/card_spider.webp","art/card_titan.webp","art/card_turret.webp","art/port_arc.webp","art/port_blaster.webp","art/port_bombard.webp","art/port_bomber.webp","art/port_boombot.webp","art/port_colossus.webp","art/port_cryo.webp","art/port_emp.webp","art/port_hive.webp","art/port_hound.webp","art/port_jet.webp","art/port_medic.webp","art/port_missile.webp","art/port_rail.webp","art/port_rocket.webp","art/port_scorcher.webp","art/port_sentinel.webp","art/port_spider.webp","art/port_titan.webp","art/port_turret.webp","icon-180.png","icon-512.png","index.html","js/battle.js","js/boot.js","js/data.js","js/ports.js","js/progress.js","js/qrcode-gen.js","js/sheets.js","js/ui.js","manifest.webmanifest","style.css","./"];
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
