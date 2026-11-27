// Core Breakers: menus, cards screen, chests, shop, settings, results.
'use strict';
(function () {
  const UI = CB.UI = {};
  const P = CB.P, $ = id => document.getElementById(id);
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const fmt = n => n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : String(n);
  const tleft = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); const hh = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return hh ? hh + 'h ' + m + 'm' : m ? m + 'm ' + ss + 's' : ss + 's'; };

  // ---------- card portraits (cropped from the rendered sheets) ----------
  const PORT = {};
  function portrait(id) {
    if (PORT[id]) return PORT[id];
    const C = CB.CARDS[id]; const cv = document.createElement('canvas'); cv.width = 160; cv.height = 190; const g = cv.getContext('2d');
    if (C.type === 'spell') { spellArt(g, id); return (PORT[id] = cv.toDataURL()); }
    const s = CB.B.sprite(C.sprite, 'blue'); if (!s) return '';
    const m = s.m, fw = m.fw, fh = m.fh; const li = m.labels.indexOf(C.air ? 'w1' : 'i0');
    const t = document.createElement('canvas'); t.width = fw; t.height = fh; const tg = t.getContext('2d');
    tg.drawImage(s.img, li * fw, 1 * fh, fw, fh, 0, 0, fw, fh);
    const d = tg.getImageData(0, 0, fw, fh).data; let x0 = fw, y0 = fh, x1 = 0, y1 = 0;
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) if (d[(y * fw + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 <= x0) return '';
    const bw = x1 - x0, bh = y1 - y0; const k = Math.min(150 / bw, 176 / bh) * (C.count > 1 ? 0.78 : 1);
    const draw = (ox, oy, kk) => g.drawImage(t, x0, y0, bw, bh, 80 - bw * kk / 2 + ox, 186 - bh * kk + oy, bw * kk, bh * kk);
    if (C.count > 1) { draw(-34, -40, k * 0.72); draw(34, -40, k * 0.72); }
    draw(0, 0, k);
    return (PORT[id] = cv.toDataURL());
  }
  function spellArt(g, id) {
    g.save(); g.translate(80, 100);
    if (id === 'missile') {
      const gr = g.createRadialGradient(0, 30, 5, 0, 30, 70); gr.addColorStop(0, '#fff3c0'); gr.addColorStop(0.4, '#ff9a2a'); gr.addColorStop(1, 'rgba(255,80,20,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 30, 70, 0, 7); g.fill();
      g.rotate(-0.7); g.fillStyle = '#e8e2d4'; g.fillRect(-11, -70, 22, 90); g.fillStyle = '#d33'; g.beginPath(); g.moveTo(-11, -70); g.lineTo(0, -96); g.lineTo(11, -70); g.fill();
      g.fillStyle = '#555'; g.beginPath(); g.moveTo(-11, 10); g.lineTo(-26, 26); g.lineTo(-11, 20); g.fill(); g.beginPath(); g.moveTo(11, 10); g.lineTo(26, 26); g.lineTo(11, 20); g.fill();
      g.fillStyle = '#ffd27a'; g.beginPath(); g.moveTo(-9, 20); g.lineTo(0, 52); g.lineTo(9, 20); g.fill();
    } else {
      for (let r = 3; r >= 1; r--) { g.strokeStyle = `rgba(140,246,255,${0.3 * r})`; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, r * 24, 0, 7); g.stroke(); }
      g.strokeStyle = '#e8ffff'; g.lineWidth = 4; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(10, -60); g.lineTo(-18, 2); g.lineTo(8, 2); g.lineTo(-12, 62); g.stroke();
      const gr = g.createRadialGradient(0, 0, 2, 0, 0, 30); gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(140,246,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 30, 0, 7); g.fill();
    }
    g.restore();
  }

  UI.cardEl = (id, lvl, o = {}) => {
    const C = CB.CARDS[id]; const R = CB.RARITY[C.rarity];
    const d = h('div', 'card ' + C.rarity + (o.small ? ' small' : '') + (o.tiny ? ' tiny' : '') + (o.locked ? ' locked' : ''));
    d.style.setProperty('--rc', R.color);
    const img = portrait(id);
    d.innerHTML = `<div class="art" style="background-image:url(${img})"></div><div class="cost">${C.cost}</div>` +
      (o.tiny ? '' : `<div class="lvl">${o.locked ? '' : 'Lv ' + (lvl || 1)}</div>`);
    if (o.progress) {
      const c = P.s.cards[id]; const need = P.need(id);
      const full = c.lvl >= CB.MAXLVL; const pct = full ? 100 : Math.min(100, c.n / need * 100);
      const can = P.canUpgrade(id), ready = !full && c.n >= need;
      d.appendChild(h('div', 'prog' + (ready ? ' ready' : '') + (can ? ' can' : ''), `<i style="width:${pct}%"></i><span>${full ? 'MAX' : c.n + '/' + need}</span>`));
      if (can) d.appendChild(h('div', 'upArrow', '▲'));
    }
    return d;
  };

  // ---------- screens ----------
  let screen = 'home';
  UI.show = name => {
    screen = name;
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === name));
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.go === name));
    $('nav').style.display = name === 'battle' ? 'none' : ''; $('topbar').style.display = name === 'battle' ? 'none' : '';
    if (name === 'home') home(); if (name === 'cards') cards(); if (name === 'shop') shop(); if (name === 'settings') settings();
    topbar();
  };
  function topbar() {
    const s = P.s; const need = s.cmd < 10 ? CB.CMD_XP[s.cmd - 1] : 1;
    $('tbLvl').textContent = s.cmd; $('tbXp').style.width = (s.cmd < 10 ? Math.min(100, s.xp / need * 100) : 100) + '%';
    $('tbXpTxt').textContent = s.cmd < 10 ? s.xp + '/' + need : 'MAX';
    $('tbTro').textContent = s.trophies; $('tbGold').textContent = fmt(s.gold);
    const up = P.upgradableCount(); const b = document.querySelector('#nav [data-go=cards] .badge'); b.textContent = up; b.style.display = up ? '' : 'none';
  }
  UI.topbar = topbar;

  function home() {
    const s = P.s; const a = P.arena(); const A = CB.ARENAS[a];
    $('arenaName').textContent = 'Arena ' + (a + 1) + ': ' + A.name;
    const nxt = CB.ARENAS[a + 1];
    $('arenaNext').innerHTML = nxt ? `Next arena at <b>${nxt.trophies}</b> 🏆` : 'Top arena reached!';
    $('arenaPic').style.setProperty('--ag', A.glow); $('arenaPic').style.setProperty('--af', A.floor);
    $('arenaPic').style.backgroundImage = CB.ARENA_META ? `url(art/arena_${a}.webp)` : '';
    $('trophyBar').style.width = nxt ? Math.min(100, (s.trophies - A.trophies) / (nxt.trophies - A.trophies) * 100) + '%' : '100%';
    // free + crown chest
    const fr = $('freeChest'); fr.innerHTML = '';
    fr.appendChild(h('div', 'mini', P.freeReady() ? '<b>Free chest</b><span>Open!</span>' : `<b>Free chest</b><span>${tleft(s.freeAt - Date.now())}</span>`));
    fr.classList.toggle('ready', P.freeReady());
    const cr = $('crownChest'); cr.innerHTML = '';
    cr.appendChild(h('div', 'mini', `<b>Crown chest</b><span>${P.crownReady() ? 'Open!' : s.crowns + '/' + CB.CROWNS_FOR_CHEST + ' 👑'}</span>`));
    cr.classList.toggle('ready', P.crownReady());
    // slots
    P.tickChests();
    const sl = $('slots'); sl.innerHTML = '';
    s.chests.forEach((c, i) => {
      const d = h('div', 'slot');
      if (!c) { d.classList.add('empty'); d.innerHTML = '<span>Win a battle<br>to earn a chest</span>'; }
      else {
        const ch = CB.CHESTS[c.type]; d.style.setProperty('--cc', ch.color); d.classList.add(c.state);
        let st = c.state === 'ready' ? '<b class="go">OPEN</b>' : c.state === 'unlocking' ? `<b>${tleft(c.unlockEnd - Date.now())}</b>` : (P.unlocking() ? `<b>${ch.mins >= 60 ? ch.mins / 60 + 'h' : ch.mins + 'm'}</b>` : '<b class="go">Unlock</b>');
        d.innerHTML = `<div class="chest" style="--cc:${ch.color}"></div><div class="cname">${ch.name.replace(' Chest', '')}</div>${st}<small>Arena ${c.arena + 1}</small>`;
        d.onclick = () => slotTap(i);
      }
      sl.appendChild(d);
    });
  }
  function slotTap(i) {
    const c = P.s.chests[i]; if (!c) return;
    if (c.state === 'ready') return openResult(P.openSlot(i));
    const ch = CB.CHESTS[c.type]; const cost = P.openNowCost(i);
    const can = c.state === 'locked' && !P.unlocking();
    modal(`<div class="chest big" style="--cc:${ch.color}"></div><h2>${ch.name}</h2>
      <p>${Math.round(ch.cards[0] + ch.cards[1] * c.arena)} cards, about ${Math.round(ch.gold[0] + ch.gold[1] * c.arena)} gold${ch.epic ? ', an Epic guaranteed' : ch.rare ? ', Rares guaranteed' : ''}${ch.legendary ? ', Legendary chance' : ''}.</p>
      <p class="dim">${c.state === 'unlocking' ? 'Unlocking: ' + tleft(c.unlockEnd - Date.now()) + ' left' : 'Takes ' + (ch.mins >= 60 ? ch.mins / 60 + ' hours' : ch.mins + ' minutes') + ' to unlock' + (can ? '' : ' (another chest is unlocking)')}</p>`,
      [can ? ['Start unlock', () => { P.startUnlock(i); closeModal(); home(); }] : null,
       [`Open now · ${cost} 🪙`, () => { if (P.s.gold < cost) return toast('Not enough gold'); closeModal(); openResult(P.openSlot(i, true)); }, P.s.gold < cost]].filter(Boolean));
  }

  // ---------- chest opening ----------
  function openResult(r) {
    if (!r) return; topbar();
    const ov = $('chestOpen'); ov.classList.add('on'); const st = $('coStage'); const ch = CB.CHESTS[r.type];
    let i = -1;
    const next = () => {
      i++;
      if (i === 0) { st.innerHTML = `<div class="chest big shake" style="--cc:${ch.color}"></div><h2>${ch.name}</h2><p class="dim">Tap to open</p>`; CB.B.sfx('tick'); return; }
      if (i === 1) { st.innerHTML = `<div class="burst"></div><div class="goldWin">+${r.gold} 🪙</div><p class="dim">${r.items.length} card types inside · tap</p>`; CB.B.sfx('win'); return; }
      const it = r.items[i - 2];
      if (!it) {
        st.innerHTML = `<h2>${ch.name}</h2><div class="sumGrid"></div><div class="goldWin small">+${r.gold} 🪙</div>`;
        const g = st.querySelector('.sumGrid'); r.items.forEach(x => { const c = UI.cardEl(x.id, P.s.cards[x.id].lvl, { small: true }); c.appendChild(h('div', 'cnt', 'x' + x.n)); g.appendChild(c); });
        st.appendChild(h('button', 'btn big', 'Done')).onclick = e => { e.stopPropagation(); ov.classList.remove('on'); UI.show(screen); };
        return;
      }
      const C = CB.CARDS[it.id]; const c = P.s.cards[it.id];
      st.innerHTML = `<div class="reveal ${C.rarity}"></div><div class="rarity" style="color:${CB.RARITY[C.rarity].color}">${it.fresh ? 'NEW CARD! ' : ''}${CB.RARITY[C.rarity].name}</div><h2>${C.name}</h2><div class="cnt big">x${it.n}</div>`;
      const ce = UI.cardEl(it.id, c.lvl, { progress: true }); ce.classList.add('pop'); st.querySelector('.reveal').appendChild(ce);
      CB.B.sfx(C.rarity === 'common' ? 'tick' : 'heal');
    };
    ov.onclick = next; next();
  }
  UI.openResult = openResult;

  // ---------- cards ----------
  let swapIn = null;
  function cards() {
    const s = P.s; const dk = $('deck'); dk.innerHTML = '';
    const avg = s.deck.reduce((a, id) => a + CB.CARDS[id].cost, 0) / 8;
    $('deckInfo').innerHTML = `Average cost <b>${avg.toFixed(1)}</b>` + (swapIn ? ` · <span class="hi">Tap a deck card to swap in ${CB.CARDS[swapIn].name}</span> <button class="btn tiny" id="cancelSwap">Cancel</button>` : '');
    if (swapIn) $('cancelSwap').onclick = () => { swapIn = null; cards(); };
    s.deck.forEach((id, k) => {
      const e = UI.cardEl(id, s.cards[id].lvl, { progress: true }); if (swapIn) e.classList.add('wiggle');
      e.onclick = () => { if (swapIn) { s.deck[k] = swapIn; swapIn = null; P.save(); cards(); } else detail(id); };
      dk.appendChild(e);
    });
    const col = $('collection'); col.innerHTML = '';
    CB.CARD_ORDER.filter(id => !s.deck.includes(id)).forEach(id => {
      const own = !!s.cards[id];
      const e = UI.cardEl(id, own ? s.cards[id].lvl : 1, { progress: own, locked: !own });
      if (!own) e.appendChild(h('div', 'lockTxt', 'Arena ' + (CB.CARDS[id].arena + 1)));
      e.onclick = () => own ? detail(id) : toast(`${CB.CARDS[id].name} unlocks in Arena ${CB.CARDS[id].arena + 1}: ${CB.ARENAS[CB.CARDS[id].arena].name} (${CB.ARENAS[CB.CARDS[id].arena].trophies} 🏆)`);
      col.appendChild(e);
    });
  }
  function stats(id, lvl) {
    const C = CB.CARDS[id], m = CB.LVL_MUL(lvl); const rows = [];
    const tg = { ground: 'Ground', air: 'Air', both: 'Air & Ground', buildings: 'Buildings', allies: 'Repairs allies' };
    if (C.hp) rows.push(['Health', Math.round(C.hp * m) + (C.count > 1 ? ' each' : '')]);
    if (C.beam) rows.push(['Beam damage', C.ramp.map(v => Math.round(v * m)).join(' → ') + ' per 0.4 s']);
    else if (C.heal) rows.push(['Repair', Math.round(C.heal * m) + ' per second']);
    else if (C.dmg) rows.push([C.type === 'spell' ? 'Area damage' : 'Damage', Math.round(C.dmg * m) + (C.splash ? ' splash' : '')]);
    if (C.towerPct) rows.push(['Tower damage', Math.round(C.dmg * m * C.towerPct)]);
    if (C.hit && !C.beam && !C.heal && C.type !== 'spell') rows.push(['Hit speed', C.hit + ' s']);
    if (C.type !== 'spell') rows.push(['Targets', tg[C.targets]]);
    if (C.range && C.type !== 'spell') rows.push(['Range', C.range < 1.2 ? 'Melee' : C.range]);
    if (C.speed) rows.push(['Speed', C.speed >= 1.4 ? 'Fast' : C.speed >= 0.95 ? 'Medium' : 'Slow']);
    if (C.count > 1) rows.push(['Count', 'x' + C.count]);
    if (C.splash) rows.push(['Splash radius', C.splash]);
    if (C.radius && C.type === 'spell') rows.push(['Radius', C.radius]);
    if (C.stun) rows.push(['Stun', C.stun + ' s']);
    if (C.life) rows.push(['Lifetime', C.life + ' s']);
    if (C.air) rows.push(['Flying', 'Yes']);
    if (C.charge) rows.push(['Charge', 'x2 damage']);
    return rows;
  }
  function detail(id) {
    const s = P.s, c = s.cards[id], C = CB.CARDS[id];
    const nextL = Math.min(CB.MAXLVL, c.lvl + 1);
    const rows = stats(id, c.lvl), rowsN = stats(id, nextL);
    const tb = rows.map((r, i) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td class="up">${c.lvl < CB.MAXLVL && rowsN[i] && rowsN[i][1] !== r[1] ? '+' + (parseInt(rowsN[i][1]) - parseInt(r[1]) || '') : ''}</td></tr>`).join('');
    const can = P.canUpgrade(id), need = P.need(id), cost = P.upCost(id);
    const inDeck = s.deck.includes(id);
    modal(`<div class="detailTop"></div><h2>${C.name} <small style="color:${CB.RARITY[C.rarity].color}">${CB.RARITY[C.rarity].name}</small></h2>
      <p class="dim">${C.desc}</p><table class="stats">${tb}</table>
      <p class="dim">${c.lvl >= CB.MAXLVL ? 'Max level!' : `Level ${c.lvl} → ${nextL}: ${c.n}/${need} cards, ${cost} 🪙`}</p>`,
      [c.lvl < CB.MAXLVL ? [`Upgrade · ${cost} 🪙`, () => {
        if (c.n < need) return toast(`Need ${need - c.n} more ${C.name} cards`);
        if (s.gold < cost) return toast('Not enough gold');
        P.upgrade(id); CB.B.sfx('win'); closeModal(); levelUpFx(id); cards(); topbar();
      }, !can] : null,
      inDeck ? null : ['Use in deck', () => { swapIn = id; closeModal(); cards(); }]].filter(Boolean));
    const top = document.querySelector('#modal .detailTop'); top.appendChild(UI.cardEl(id, c.lvl, { progress: true }));
  }
  function levelUpFx(id) {
    const c = P.s.cards[id]; const ov = h('div', 'lvlUp', `<div class="rays"></div><div class="cardHold"></div><h2>Level ${c.lvl}!</h2>` + (P.cmdUp ? `<p>Commander level ${P.s.cmd}! Your towers got stronger.</p>` : ''));
    ov.querySelector('.cardHold').appendChild(UI.cardEl(id, c.lvl, {})); document.body.appendChild(ov); P.cmdUp = false;
    ov.onclick = () => ov.remove(); setTimeout(() => ov.remove(), 2600);
  }

  // ---------- shop ----------
  function shop() {
    const sh = P.shop(); const el = $('offers'); el.innerHTML = '';
    sh.offers.forEach((o, i) => {
      const d = h('div', 'offer' + (o.bought ? ' bought' : ''));
      const ce = UI.cardEl(o.id, P.s.cards[o.id].lvl, { small: true }); ce.appendChild(h('div', 'cnt', 'x' + o.n));
      d.appendChild(ce);
      const b = h('button', 'btn', o.bought ? 'Bought' : o.price + ' 🪙'); b.disabled = o.bought;
      b.onclick = () => { if (P.buyOffer(i)) { CB.B.sfx('heal'); shop(); topbar(); } else toast('Not enough gold'); };
      d.appendChild(b); el.appendChild(d);
    });
    const cs = $('shopChests'); cs.innerHTML = '';
    for (const t in P.CHEST_PRICES) {
      const ch = CB.CHESTS[t]; const d = h('div', 'offer chestOffer', `<div class="chest" style="--cc:${ch.color}"></div><b>${ch.name}</b>`);
      const b = h('button', 'btn', P.CHEST_PRICES[t] + ' 🪙'); b.onclick = () => { if (P.s.gold < P.CHEST_PRICES[t]) return toast('Not enough gold'); openResult(P.buyChest(t)); };
      d.appendChild(b); cs.appendChild(d);
    }
    const ms = new Date(); ms.setHours(24, 0, 0, 0); $('shopReset').textContent = 'New offers in ' + tleft(ms - Date.now());
  }

  // ---------- settings ----------
  function settings() {
    const s = P.s;
    $('setSound').textContent = s.sound ? 'Sound: On' : 'Sound: Off';
    $('setStats').innerHTML = `Wins <b>${s.wins}</b> · Losses <b>${s.losses}</b> · Draws <b>${s.draws}</b> · Best <b>${s.best}</b> 🏆`;
  }

  // ---------- battle ----------
  const NAMES = ['Rustbolt', 'Vex-9', 'Ironclad', 'Nova Prime', 'Gearjaw', 'Sparkfang', 'Titanium Tom', 'Circuit', 'Overclock', 'Byte Baron', 'Scrapper', 'Volt Viper'];
  UI.battle = () => {
    const s = P.s; const a = P.arena();
    const pool = CB.CARD_ORDER.filter(id => CB.CARDS[id].arena <= a);
    const pick = new Set();
    const tanks = pool.filter(id => ['titan', 'colossus', 'sentinel', 'hound'].includes(id));
    const anti = pool.filter(id => ['blaster', 'jet', 'rocket'].includes(id));
    pick.add(tanks[Math.floor(Math.random() * tanks.length)]); pick.add(anti[Math.floor(Math.random() * anti.length)]);
    while (pick.size < 8) pick.add(pool[Math.floor(Math.random() * pool.length)]);
    const myLv = {}; s.deck.forEach(id => myLv[id] = s.cards[id].lvl);
    const avg = s.deck.reduce((t, id) => t + s.cards[id].lvl, 0) / 8;
    const inArena = (() => { const A = CB.ARENAS[a], N = CB.ARENAS[a + 1]; return N ? (s.trophies - A.trophies) / (N.trophies - A.trophies) : 0.5; })();
    const aiLv = {}; [...pick].forEach(id => aiLv[id] = Math.max(1, Math.min(CB.MAXLVL, Math.round(avg - 0.6 + inArena * 0.8 + (Math.random() - 0.5)))));
    if (s.wins + s.losses < 2) Object.keys(aiLv).forEach(k => aiLv[k] = Math.max(1, aiLv[k] - 1));
    const name = NAMES[Math.floor(Math.random() * NAMES.length)];
    $('bThem').textContent = name; $('bMe').textContent = s.name;
    UI.show('battle');
    CB.B.start({
      deck: s.deck.slice(), levels: myLv, cmd: s.cmd, arena: a,
      enemy: { deck: [...pick], levels: aiLv, cmd: Math.max(1, s.cmd + (Math.random() < 0.3 ? -1 : 0)), skill: Math.min(1, 0.35 + a * 0.15 + inArena * 0.1), emul: s.trophies < 150 ? 0.8 : s.trophies < 300 ? 0.9 : 1 },
      onEnd: res => { CB.B.stop(); results(res, name); },
    });
  };
  function results(res, name) {
    const r = P.result(res.me, res.them);
    const ov = $('result'); ov.classList.add('on');
    const title = r.win ? 'VICTORY' : r.draw ? 'DRAW' : 'DEFEAT';
    ov.innerHTML = `<div class="resBox ${r.win ? 'win' : r.draw ? 'draw' : 'lose'}"><h1>${title}</h1>
      <div class="crowns"><div><span>You</span><b>${'👑'.repeat(res.me) || '–'}</b></div><div><span>${name}</span><b>${'👑'.repeat(res.them) || '–'}</b></div></div>
      <div class="trophy ${r.dt >= 0 ? 'up' : 'down'}">${r.dt >= 0 ? '+' : ''}${r.dt} 🏆 <small>(${r.after})</small></div>
      ${r.gold ? `<div class="goldWin small">+${r.gold} 🪙</div>` : ''}
      ${r.chest ? `<div class="won"><div class="chest" style="--cc:${CB.CHESTS[r.chest].color}"></div>${CB.CHESTS[r.chest].name} added!</div>` : r.win ? '<div class="dim">Chest slots are full: open some to earn more.</div>' : ''}
      ${r.newArena >= 0 ? `<div class="newArena">New arena: ${CB.ARENAS[r.newArena].name}!${r.unlocked.length ? '<br>Unlocked: ' + r.unlocked.map(id => CB.CARDS[id].name).join(', ') : ''}</div>` : ''}
      <button class="btn big" id="resOk">OK</button></div>`;
    $('resOk').onclick = () => { ov.classList.remove('on'); UI.show('home'); };
  }

  // ---------- modal + toast ----------
  function modal(html, buttons) {
    const m = $('modal'); m.classList.add('on');
    m.innerHTML = `<div class="mBox"><button class="x">✕</button>${html}<div class="mBtns"></div></div>`;
    const bb = m.querySelector('.mBtns');
    (buttons || []).forEach(([t, f, dim]) => { const b = h('button', 'btn' + (dim ? ' dim' : ''), t); b.onclick = f; bb.appendChild(b); });
    m.querySelector('.x').onclick = closeModal; m.onclick = e => { if (e.target === m) closeModal(); };
  }
  function closeModal() { $('modal').classList.remove('on'); }
  function toast(t) { const e = $('toast'); e.textContent = t; e.classList.remove('on'); void e.offsetWidth; e.classList.add('on'); }
  UI.toast = toast; UI.modal = modal; UI.closeModal = closeModal;

  // ---------- share: QR code of the public link, drawn offline ----------
  const SHARE_URL = 'https://jtrh41.github.io/core-breakers/';
  function qrSvg(text) {
    try { const q = qrcode(0, 'M'); q.addData(text); q.make(); const n = q.getModuleCount(); let d = '';
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) d += 'M' + x + ' ' + y + 'h1v1h-1z';
      return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#0c0f16"/></svg>`;
    } catch (e) { return ''; }
  }
  UI.share = () => {
    modal(`<h2>Share Core Breakers</h2><p class="dim">Scan with a phone or iPad camera, open in Safari, then Share → Add to Home Screen.</p>
      <div class="qrBox">${qrSvg(SHARE_URL)}</div><p class="shareUrl">${SHARE_URL}</p>`,
      [[navigator.share ? 'Send link' : 'Copy link', () => {
        if (navigator.share) navigator.share({ title: 'Core Breakers', text: 'Robot card battles! Add it to your Home Screen.', url: SHARE_URL }).catch(() => { });
        else { try { navigator.clipboard.writeText(SHARE_URL).then(() => toast('Link copied'), () => toast(SHARE_URL)); } catch (e) { toast(SHARE_URL); } }
      }]]);
  };

  // ---------- boot ----------
  UI.boot = () => {
    document.querySelectorAll('#nav button').forEach(b => b.onclick = () => UI.show(b.dataset.go));
    $('battleBtn').onclick = () => UI.battle();
    $('freeChest').onclick = () => { if (P.freeReady()) openResult(P.openFree()); else toast('Free chest in ' + tleft(P.s.freeAt - Date.now())); };
    $('crownChest').onclick = () => { if (P.crownReady()) openResult(P.openCrown()); else toast('Win crowns in battle: ' + (CB.CROWNS_FOR_CHEST - P.s.crowns) + ' more for a Crown Chest'); };
    $('setShare').onclick = UI.share; $('tbShare').onclick = UI.share;
    $('setSound').onclick = () => { P.s.sound = !P.s.sound; P.save(); settings(); };
    $('setName').onclick = () => modal(`<h2>Your name</h2><input id="nmIn" maxlength="16" value="${P.s.name.replace(/"/g, '')}">`, [['Save', () => { const v = $('nmIn').value.trim(); if (v) { P.s.name = v; P.save(); } closeModal(); }]]);
    $('setBackup').onclick = () => {
      const code = P.backupCode();
      modal(`<h2>Backup code</h2><p class="dim">Keep this somewhere safe (Notes, a message to yourself). Paste it into Restore on any device to get your progress back.</p><textarea readonly id="bkTxt">${code}</textarea>`,
        [['Copy', () => { const t = $('bkTxt'); t.select(); try { navigator.clipboard.writeText(code).then(() => toast('Copied'), () => { document.execCommand('copy'); toast('Copied'); }); } catch (e) { document.execCommand('copy'); toast('Copied'); } }]]);
    };
    $('setRestore').onclick = () => modal(`<h2>Restore progress</h2><p class="dim">Paste a backup code. This replaces the progress on this device.</p><textarea id="rsTxt" placeholder="CB1...."></textarea>`,
      [['Restore', () => { if (P.restore($('rsTxt').value)) { closeModal(); toast('Progress restored'); UI.show('home'); } else toast('That code did not work'); }]]);
    $('setReset').onclick = () => modal('<h2>Start over?</h2><p>This deletes all cards, gold and trophies on this device. Make a backup code first if you might want them back.</p>',
      [['Yes, start over', () => { P.reset(); closeModal(); UI.show('home'); }], ['Cancel', closeModal]]);
    CB.B.bindInput();
    UI.show('home');
    const gift = P.claimGift();
    if (gift) { modal(`<div class="burst"></div><h2>🎁 ${gift.text}</h2><div class="goldWin">+${gift.gold.toLocaleString()} 🪙</div><p class="dim">Use it to upgrade your cards in the Cards tab.</p>`, [['Awesome!', () => { closeModal(); UI.show('home'); }]]); CB.B.sfx('win'); topbar(); }
    setInterval(() => { if (screen === 'home') home(); topbar(); }, 1000);
  };
})();
