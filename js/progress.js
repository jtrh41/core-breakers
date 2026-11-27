// Core Breakers: the player's save (cards, levels, gold, trophies, chests) and everything that changes it.
'use strict';
(function () {
  const KEY = 'cb_save_v1';
  const now = () => Date.now();

  function fresh() {
    const cards = {};
    CB.CARD_ORDER.forEach(id => { if (CB.CARDS[id].arena === 0) cards[id] = { lvl: 1, n: 0 }; });
    return {
      v: 1, name: 'Commander', gold: 100, xp: 0, cmd: 1, trophies: 0, best: 0,
      cards, deck: CB.START_DECK.slice(),
      chests: [null, null, null, null],   // {type, arena, unlockEnd (ms) | null, state:'locked'|'unlocking'|'ready'}
      cycle: 0, freeAt: now(), crowns: 0, wins: 0, losses: 0, draws: 0, streak: 0,
      shop: null, sound: true, seen: {}, created: now(),
    };
  }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.v === 1) return fix(s);
    } catch (e) { }
    return fresh();
  }
  function fix(s) {   // fill in anything an older save is missing
    const f = fresh();
    for (const k in f) if (!(k in s)) s[k] = f[k];
    CB.CARD_ORDER.forEach(id => { if (CB.CARDS[id].arena <= CB.arenaOf(s.best) && !s.cards[id]) s.cards[id] = { lvl: 1, n: 0 }; });
    s.deck = s.deck.filter(id => s.cards[id]);
    for (const id of CB.START_DECK) if (s.deck.length < 8 && !s.deck.includes(id)) s.deck.push(id);
    return s;
  }
  let S = load();
  const P = CB.P = {
    get s() { return S; },
    save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } },
    reset() { S = fresh(); P.save(); },
  };

  P.arena = () => CB.arenaOf(S.trophies);
  P.unlockedArena = () => CB.arenaOf(S.best);

  // ---------- cards ----------
  P.need = id => { const c = S.cards[id]; return c.lvl >= CB.MAXLVL ? 0 : CB.RARITY[CB.CARDS[id].rarity].need[c.lvl - 1]; };
  P.upCost = id => { const c = S.cards[id]; return c.lvl >= CB.MAXLVL ? 0 : CB.UPGRADE_GOLD[c.lvl - 1] * CB.RARITY[CB.CARDS[id].rarity].goldMul; };
  P.canUpgrade = id => { const c = S.cards[id]; return c && c.lvl < CB.MAXLVL && c.n >= P.need(id) && S.gold >= P.upCost(id); };
  P.upgrade = id => {
    if (!P.canUpgrade(id)) return false;
    const c = S.cards[id]; const xp = CB.UPGRADE_XP[c.lvl - 1] * CB.RARITY[CB.CARDS[id].rarity].xp;
    S.gold -= P.upCost(id); c.n -= P.need(id); c.lvl++;
    P.addXp(xp); P.save(); return true;
  };
  P.addXp = xp => {
    S.xp += xp;
    while (S.cmd < 10 && S.xp >= CB.CMD_XP[S.cmd - 1]) { S.xp -= CB.CMD_XP[S.cmd - 1]; S.cmd++; P.cmdUp = true; }
  };
  P.upgradableCount = () => Object.keys(S.cards).filter(P.canUpgrade).length;

  // ---------- chests ----------
  P.chestFor = () => { const t = CB.CHEST_CYCLE[S.cycle % CB.CHEST_CYCLE.length]; S.cycle++; return t; };
  P.addChest = type => {
    const i = S.chests.findIndex(c => !c);
    if (i < 0) return -1;
    S.chests[i] = { type, arena: P.arena(), state: 'locked', unlockEnd: null };
    return i;
  };
  P.tickChests = () => {
    let ch = false;
    S.chests.forEach(c => { if (c && c.state === 'unlocking' && now() >= c.unlockEnd) { c.state = 'ready'; ch = true; } });
    if (ch) P.save();
  };
  P.unlocking = () => S.chests.some(c => c && c.state === 'unlocking');
  P.startUnlock = i => {
    const c = S.chests[i]; if (!c || c.state !== 'locked' || P.unlocking()) return false;
    c.state = 'unlocking'; c.unlockEnd = now() + CB.CHESTS[c.type].mins * 60000; P.save(); return true;
  };
  P.openNowCost = i => {
    const c = S.chests[i]; if (!c) return 0;
    const mins = c.state === 'unlocking' ? Math.max(0, (c.unlockEnd - now()) / 60000) : CB.CHESTS[c.type].mins;
    return Math.max(1, Math.ceil(mins * CB.OPEN_NOW_GOLD_PER_MIN));
  };

  // Rolls a chest: returns {gold, items:[{id, n}]} and adds them to the save.
  P.openChest = (type, arena) => {
    const ch = CB.CHESTS[type]; const a = arena == null ? P.arena() : arena;
    const total = Math.round(ch.cards[0] + ch.cards[1] * a);
    const gold = Math.round((ch.gold[0] + ch.gold[1] * a) * (0.85 + Math.random() * 0.3));
    const pool = r => CB.CARD_ORDER.filter(id => CB.CARDS[id].rarity === r && CB.CARDS[id].arena <= Math.max(a, P.unlockedArena()));
    const pick = r => { const p = pool(r); return p.length ? p[Math.floor(Math.random() * p.length)] : null; };
    const got = {};
    const give = (id, n) => { if (id && n > 0) got[id] = (got[id] || 0) + n; };
    let left = total;
    // guaranteed rarer cards (fractions are a chance)
    for (const r of ['legendary', 'epic', 'rare']) {
      let g = ch[r] || 0; let n = Math.floor(g); if (Math.random() < g - n) n++;
      if (r === 'legendary' && n === 0 && Math.random() < 0.004 * total) n = 1;
      if (r === 'epic' && Math.random() < 0.01 * total) n++;
      n = Math.min(n, left); if (n > 0 && pool(r).length) { give(pick(r), n); left -= n; }
    }
    // the rest are commons and a few rares, in 2-4 stacks
    const stacks = Math.min(left, 2 + Math.floor(Math.random() * 3));
    for (let k = 0; k < stacks; k++) {
      const n = k === stacks - 1 ? left : Math.max(1, Math.round(left / (stacks - k) * (0.6 + Math.random() * 0.8)));
      const id = Math.random() < 0.18 ? (pick('rare') || pick('common')) : pick('common');
      give(id, Math.min(n, left)); left -= Math.min(n, left);
    }
    const items = Object.keys(got).map(id => ({ id, n: got[id], fresh: !S.cards[id] }))
      .sort((x, y) => ['common', 'rare', 'epic', 'legendary'].indexOf(CB.CARDS[x.id].rarity) - ['common', 'rare', 'epic', 'legendary'].indexOf(CB.CARDS[y.id].rarity));
    items.forEach(it => { if (!S.cards[it.id]) S.cards[it.id] = { lvl: 1, n: 0 }; S.cards[it.id].n += it.n; });
    S.gold += gold; P.save();
    return { gold, items, type };
  };
  P.openSlot = (i, pay) => {
    const c = S.chests[i]; if (!c) return null;
    if (c.state !== 'ready') { if (!pay) return null; const cost = P.openNowCost(i); if (S.gold < cost) return null; S.gold -= cost; }
    S.chests[i] = null; return P.openChest(c.type, c.arena);
  };
  P.freeReady = () => now() >= S.freeAt;
  P.openFree = () => { if (!P.freeReady()) return null; S.freeAt = now() + CB.FREE_CHEST_HOURS * 3600000; return P.openChest('free'); };
  P.crownReady = () => S.crowns >= CB.CROWNS_FOR_CHEST;
  P.openCrown = () => { if (!P.crownReady()) return null; S.crowns = 0; return P.openChest('crown'); };

  // ---------- battle results ----------
  P.result = (myCrowns, theirCrowns) => {
    const win = myCrowns > theirCrowns, draw = myCrowns === theirCrowns;
    const before = S.trophies, arenaBefore = P.arena();
    let dt = 0, chest = null, slot = -1, gold = 0;
    if (win) {
      dt = 28 + Math.floor(Math.random() * 5); S.wins++; S.streak = Math.max(1, S.streak + 1);
      gold = CB.ARENAS[arenaBefore].gold + myCrowns * 5;
      chest = P.chestFor(); slot = P.addChest(chest); if (slot < 0) chest = null;
    } else if (!draw) {
      dt = -(18 + Math.floor(Math.random() * 5)); S.losses++; S.streak = 0;
      dt = Math.max(dt, CB.ARENAS[arenaBefore].trophies - S.trophies);   // never drop below the arena you are in
    } else { S.draws++; gold = 5; }
    S.crowns = Math.min(CB.CROWNS_FOR_CHEST, S.crowns + myCrowns);
    S.trophies = Math.max(0, S.trophies + dt); S.gold += gold;
    const newArena = CB.arenaOf(S.trophies) > CB.arenaOf(S.best) ? CB.arenaOf(S.trophies) : -1;
    S.best = Math.max(S.best, S.trophies);
    const unlocked = [];
    if (newArena >= 0) CB.CARD_ORDER.forEach(id => { if (CB.CARDS[id].arena <= newArena && !S.cards[id]) { S.cards[id] = { lvl: 1, n: 1 }; unlocked.push(id); } });
    P.save();
    return { win, draw, dt, before, after: S.trophies, chest, slot, gold, newArena, unlocked };
  };

  // ---------- shop: three card offers a day plus chests for gold ----------
  P.shop = () => {
    const day = new Date().toDateString();
    if (!S.shop || S.shop.day !== day) {
      const own = Object.keys(S.cards); const offers = [];
      const shuffled = own.sort(() => Math.random() - 0.5);
      for (const id of shuffled.slice(0, 3)) {
        const r = CB.CARDS[id].rarity; const n = { common: 20, rare: 6, epic: 2, legendary: 1 }[r];
        const price = { common: 10, rare: 60, epic: 400, legendary: 2000 }[r] * n;
        offers.push({ id, n, price, bought: false });
      }
      S.shop = { day, offers }; P.save();
    }
    return S.shop;
  };
  P.buyOffer = i => { const o = P.shop().offers[i]; if (!o || o.bought || S.gold < o.price) return false; S.gold -= o.price; S.cards[o.id].n += o.n; o.bought = true; P.save(); return true; };
  P.CHEST_PRICES = { gold: 250, magic: 900 };
  P.buyChest = type => { const p = P.CHEST_PRICES[type]; if (!p || S.gold < p) return null; S.gold -= p; return P.openChest(type); };

  // ---------- one-time gifts (from the family, given on the next app open) ----------
  P.GIFTS = [{ id: 'gold10k-2026-11-26', gold: 10000, before: Date.parse('2026-11-27T04:00:00Z'), text: 'A gift for you!' }];
  P.claimGift = () => {
    S.gifts = S.gifts || [];
    for (const g of P.GIFTS) {
      if (S.gifts.includes(g.id)) continue;
      S.gifts.push(g.id);
      if ((S.created || 0) >= g.before) { P.save(); continue; }   // only saves that existed when the gift was made
      S.gold += g.gold; P.save(); return g;
    }
    return null;
  };

  // ---------- backup code ----------
  function sum(str) { let h = 7; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; return h.toString(36); }
  P.backupCode = () => { const j = JSON.stringify(S); const b = btoa(unescape(encodeURIComponent(j))); return 'CB1.' + sum(b) + '.' + b; };
  P.restore = code => {
    try {
      const [tag, h, b] = code.trim().replace(/\s+/g, '').split('.');
      if (tag !== 'CB1' || sum(b) !== h) return false;
      const s = JSON.parse(decodeURIComponent(escape(atob(b))));
      if (!s || s.v !== 1) return false;
      S = fix(s); P.save(); return true;
    } catch (e) { return false; }
  };
})();
