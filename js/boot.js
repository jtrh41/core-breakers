'use strict';
(function () {
  const lf = document.getElementById('lfill');
  lf.style.width = '60%';
  CB.B.loadArena(CB.P.arena()).then(() => {
    document.getElementById('loading').classList.add('gone');
    CB.UI.boot();
  });
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
})();
