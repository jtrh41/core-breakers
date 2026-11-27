'use strict';
(function () {
  const lf = document.getElementById('lfill');
  const arenaImgs = [];
  CB.B.arenaImg = arenaImgs;
  const arenas = CB.ARENA_META ? CB.ARENAS.map((a, i) => new Promise(r => { const im = new Image(); im.onload = im.onerror = r; im.src = 'art/arena_' + i + '.webp?v=' + (CB.ARENA_V || '1'); arenaImgs[i] = im; })) : [];
  Promise.all([CB.B.loadSprites(p => lf.style.width = Math.round(p * 100) + '%'), ...arenas]).then(() => {
    document.getElementById('loading').classList.add('gone');
    CB.UI.boot();
  });
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
})();
