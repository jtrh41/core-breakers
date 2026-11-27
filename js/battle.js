// Core Breakers: the battle. Simulation (units, towers, projectiles, spells), the computer opponent, drawing and touch input.
'use strict';
(function () {
  const B = CB.B = {};
  const W = CB.W, H = CB.H, R0 = CB.RIVER[0], R1 = CB.RIVER[1], MIDY = (R0 + R1) / 2;
  const TEAM = ['blue', 'red'];
  const US = 1.45;   // robots are drawn larger than their footprint so they read well on a phone
  const SPS = { jet: 0.8, minidrone: 0.9 };   // per-robot fine-tuning of on-screen size
  const FD = 0.09;   // seconds per attack frame (6 frames: wind-up, strike, follow-through)
  const IMPACT = { sentinel: 2, blaster: 1, spider: 2, turret: 1, jet: 1, titan: 3, rocket: 1, hound: 2, rail: 2, arc: 1, bombard: 1, bomber: 2, minidrone: 1, boombot: 2 };   // frame where the hit lands
  const TCOL = tm => tm ? ['#ff7a2a', '#ffd6a8', '255,122,42'] : ['#38e6ff', '#dafcff', '56,230,255'];
  const DT = 1 / 60;   // simulation steps per second: 60 keeps movement smooth on 60/120 Hz screens
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // ---------------- sprites ----------------
  const SPR = {};
  // Each sheet is requested with its content version (?v=), so an old offline copy can never be paired with new frame data.
  // If an image still arrives with the wrong size, it is fetched again past every cache.
  // Loads the given sheets (both teams) and frees the rest, so only the robots in this battle sit in memory.
  // Each sheet is requested with its content version (?v=), so an old offline copy can never be paired with new frame data;
  // an image that still arrives with the wrong size is fetched again past every cache.
  B.loadSprites = (wantNames, onProgress) => new Promise(res => {
    // wantNames: 'sheet' (both teams) or 'sheet_blue' / 'sheet_red'
    const sheets = CB.SHEETS || {}; const want = new Set();
    for (const w of (wantNames || Object.keys(sheets))) { if (/_(blue|red)$/.test(w)) want.add(w); else for (const t of TEAM) want.add(w + '_' + t); }
    for (const k in SPR) { const n = k.slice(0, k.lastIndexOf('_')); if (!want.has(k) || SPR[k].m.v !== (sheets[n] || {}).v) { SPR[k].img.src = ''; delete SPR[k]; } }
    const names = [];
    for (const w of want) { const i = w.lastIndexOf('_'), n = w.slice(0, i), t = w.slice(i + 1); if (sheets[n] && !SPR[w]) names.push([n, t]); }
    let left = names.length; if (!left) return res();
    const total = names.length;
    names.forEach(([n, t]) => {
      const m = sheets[n]; const wantW = m.fw * m.labels.length, wantH = m.fh * m.dirs;
      const load = (tries) => {
        const img = new Image(); img.decoding = 'async';
        img.onload = img.onerror = () => {
          const ok = img.naturalWidth === wantW && img.naturalHeight === wantH;
          if (!ok && tries < 2) return load(tries + 1);
          const done = () => { left--; onProgress && onProgress(1 - left / total); if (!left) res(); };
          if (ok) { SPR[n + '_' + t] = { img, m }; (img.decode ? img.decode() : Promise.resolve()).then(done, done); } else done();
        };
        img.src = 'art/' + n + '_' + t + '.webp?v=' + (m.v || '1') + (tries ? '&r=' + Date.now() : '');
      };
      load(0);
    });
  });
  const ARENA_IMG = {};
  B.loadArena = (i) => new Promise(res => {
    if (!CB.ARENA_META) return res();
    if (ARENA_IMG[i] && ARENA_IMG[i].naturalWidth) return res();
    for (const k in ARENA_IMG) if (+k !== i) delete ARENA_IMG[k];   // keep one big arena image in memory at a time
    const im = new Image(); im.onload = () => (im.decode ? im.decode() : Promise.resolve()).then(res, res); im.onerror = res;
    im.src = 'art/arena_' + i + '.webp?v=' + (CB.ARENA_V || '1'); ARENA_IMG[i] = im;
  });
  B.sprite = (n, t) => SPR[n + '_' + t];
  // octant (0=E,1=SE,2=S,...) -> [render direction, mirrored]
  const OCT = [[2, 0], [1, 0], [0, 0], [1, 1], [2, 1], [3, 1], [4, 0], [3, 0]];
  function dirOf(angle) { let k = Math.round(angle / (Math.PI / 4)); k = ((k % 8) + 8) % 8; return OCT[k]; }
  B.drawSprite = (ctx, name, team, label, angle, x, y, scale, alpha) => {
    const s = SPR[name + '_' + team]; if (!s) return false;
    const m = s.m; const li = m.labels.indexOf(label); if (li < 0) return false;
    let [d, mir] = m.dirs === 1 ? [0, 0] : dirOf(angle);
    const fw = m.fw, fh = m.fh, k = scale / m.ppm;
    ctx.save(); ctx.translate(x, y); if (mir) ctx.scale(-1, 1);
    if (alpha != null) ctx.globalAlpha = alpha;
    const ax = m.ax != null ? m.ax : fw / 2, ay = m.ay != null ? m.ay : m.anchor * fh;
    ctx.drawImage(s.img, li * fw, d * fh, fw, fh, -ax * k, -ay * k, fw * k, fh * k);
    ctx.restore(); return true;
  };

  // ---------------- sound (tiny synth, no files) ----------------
  let AC = null; const lastS = {};
  B.sfx = (kind) => {
    if (!CB.P.s.sound) return;
    try {
      if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
      if (AC.state === 'suspended') AC.resume();
      const t = AC.currentTime; if (lastS[kind] && t - lastS[kind] < 0.05) return; lastS[kind] = t;
      const o = AC.createOscillator(), g = AC.createGain(); o.connect(g); g.connect(AC.destination);
      const S = {
        laser: ['square', 880, 220, 0.09, 0.035], shell: ['sawtooth', 220, 60, 0.15, 0.05], boom: ['sawtooth', 120, 30, 0.45, 0.12],
        hit: ['triangle', 300, 120, 0.08, 0.05], deploy: ['sine', 300, 700, 0.18, 0.08], zap: ['square', 1400, 200, 0.25, 0.05],
        tower: ['sawtooth', 160, 50, 0.6, 0.12], tick: ['sine', 900, 900, 0.05, 0.04], beam: ['sawtooth', 500, 520, 0.12, 0.02],
        heal: ['sine', 600, 900, 0.2, 0.04], win: ['triangle', 400, 900, 0.7, 0.1], no: ['square', 160, 120, 0.15, 0.05],
      }[kind]; if (!S) return;
      o.type = S[0]; o.frequency.setValueAtTime(S[1], t); o.frequency.exponentialRampToValueAtTime(Math.max(20, S[2]), t + S[3]);
      g.gain.setValueAtTime(S[4], t); g.gain.exponentialRampToValueAtTime(0.0001, t + S[3]);
      if (kind === 'boom' || kind === 'tower') {   // add noise for explosions
        const len = Math.floor(AC.sampleRate * S[3]); const buf = AC.createBuffer(1, len, AC.sampleRate); const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const n = AC.createBufferSource(), ng = AC.createGain(); n.buffer = buf; ng.gain.value = S[4] * 1.4; n.connect(ng); ng.connect(AC.destination); n.start(t);
      }
      o.start(t); o.stop(t + S[3] + 0.02);
    } catch (e) { }
  };

  // ---------------- world ----------------
  let G = null;   // the current battle
  let nextId = 1;

  function mkTower(team, sub, x, y, lane, cmd) {
    const T = CB.TOWERS[sub], m = CB.CMD_MUL(cmd);
    return { id: nextId++, team, kind: 'tower', sub, lane, x, y, r: T.radius, mass: 1e9, hp: Math.round(T.hp * m), maxHp: Math.round(T.hp * m),
      dmg: Math.round(T.dmg * m), hit: T.hit, range: T.range, sight: T.range, targets: 'both', cd: 0.5, alive: true,
      active: sub === 'guard', face: team ? Math.PI / 2 : -Math.PI / 2, fireT: 9, lvl: cmd, air: false };
  }

  function mkUnit(team, id, lvl, x, y) {
    const c = CB.CARDS[id], m = CB.LVL_MUL(lvl);
    return { id: nextId++, team, kind: c.type === 'building' ? 'building' : 'troop', card: id, c, lvl, x, y, r: c.radius, mass: c.mass,
      hp: Math.round(c.hp * m), maxHp: Math.round(c.hp * m), dmg: Math.round(c.dmg * m), hit: c.hit, range: c.range, sight: c.sight,
      speed: c.speed, targets: c.targets, air: !!c.air, cd: 0.3, deploy: 1.0, stun: 0, alive: true, target: null, retarget: 0,
      face: team ? Math.PI / 2 : -Math.PI / 2, anim: 'idle', animT: 0, walkPh: Math.random(), atkT: 9, moved: 0, charging: false,
      beamT: 0, beamTarget: null, life: c.life || 0, healT: 0, flash: 0 };
  }

  B.start = (opt) => {
    const cmdMe = opt.cmd, cmdAi = opt.enemy.cmd;
    G = {
      t: 0, time: CB.MATCH_SECS, overtime: false, over: false, opt,
      ents: [], proj: [], fx: [], decals: [], scorch: [],
      motes: Array.from({ length: 26 }, () => ({ x: rnd(0, W), y: rnd(0, H), z: rnd(0.3, 3), p: rnd(0, 6) })),
      energy: [5, 5], crowns: [0, 0],
      deck: [shuffle(opt.deck.slice()), shuffle(opt.enemy.deck.slice())],
      lvls: [opt.levels, opt.enemy.levels],
      sel: null, drag: null, hover: null, msg: [], shake: 0,
      ai: { think: 1.5, plan: null, lvl: opt.enemy.skill },
      arena: opt.arena,
    };
    for (const tm of [0, 1]) {
      const fy = y => tm ? H - y : y;
      G.ents.push(mkTower(tm, 'guard', 3.5, fy(28), 0, tm ? cmdAi : cmdMe));
      G.ents.push(mkTower(tm, 'guard', 14.5, fy(28), 1, tm ? cmdAi : cmdMe));
      G.ents.push(mkTower(tm, 'king', 9, fy(29.6), -1, tm ? cmdAi : cmdMe));
    }
    renderHand(); layout(); buildBg();
    B.running = true; last = performance.now(); acc = 0;
    requestAnimationFrame(frame);
    say('Battle!', 1.4);
  };
  B.stop = () => { B.running = false; G = null; };
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function say(text, dur, col) { G.msg.push({ text, t: dur || 1.5, dur: dur || 1.5, col: col || '#fff' }); }

  // ---------------- rules ----------------
  const enemyOf = u => G.ents.filter(e => e.alive && e.team !== u.team);
  function canHit(u, e) {
    if (u.targets === 'buildings') return e.kind === 'tower' || e.kind === 'building';
    if (u.targets === 'ground') return !e.air;
    if (u.targets === 'air') return e.air;
    return true;
  }
  const gap = (a, b) => dist(a, b) - a.r - b.r;

  function laneTower(u) {   // where a troop walks when nothing is in sight: nearest enemy tower (lane first, then king)
    let best = null, bd = 1e9;
    for (const e of G.ents) {
      if (!e.alive || e.team === u.team || (e.kind !== 'tower' && e.kind !== 'building')) continue;
      if (e.kind === 'building' && gap(u, e) > u.sight) continue;
      const d = Math.abs(e.x - u.x) * 1.4 + Math.abs(e.y - u.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function findTarget(u) {
    if (u.targets === 'allies' || u.targets === 'none') return null;
    let best = null, bd = 1e9;
    for (const e of G.ents) {
      if (!e.alive || e.team === u.team || !canHit(u, e)) continue;
      const g = gap(u, e);
      if (u.c && u.c.minRange && g < u.c.minRange) continue;
      if (g <= u.sight && g < bd) { bd = g; best = e; }
    }
    if (best) return best;
    if (u.kind === 'troop') { const t = laneTower(u); if (t && canHit(u, t)) return t; return t; }
    return null;
  }

  function waypoint(u, tx, ty) {
    if (u.air) return [tx, ty];
    const uSide = u.y > MIDY ? 1 : 0, tSide = ty > MIDY ? 1 : 0;
    const inRiver = u.y > R0 - 0.05 && u.y < R1 + 0.05;
    if (!inRiver && uSide === tSide) return [tx, ty];
    let br = CB.BRIDGES[0], bd = 1e9;
    for (const b of CB.BRIDGES) { const bx = (b[0] + b[1]) / 2; const d = Math.abs(u.x - bx) + Math.abs(tx - bx) * 0.6; if (d < bd) { bd = d; br = b; } }
    const bx = (br[0] + br[1]) / 2;
    if (inRiver) { const ex = clamp(u.x, br[0] + 0.45, br[1] - 0.45); return [ex, tSide ? R1 + 0.7 : R0 - 0.7]; }
    const entryY = uSide ? R1 + 0.25 : R0 - 0.25;
    if (Math.abs(u.x - bx) < 0.6 && Math.abs(u.y - entryY) < 0.9) return [clamp(u.x, br[0] + 0.45, br[1] - 0.45), tSide ? R1 + 0.7 : R0 - 0.7];
    return [bx, entryY];
  }

  function damage(e, amt, src) {
    if (!e.alive || amt <= 0) return;
    e.hp -= amt; e.flash = 0.12;
    if (src && e.kind !== 'tower' && !G.sim) { e.kickT = 0.14; e.kickA = Math.atan2(e.y - src.y, e.x - src.x); e.kickD = Math.min(0.35, 0.08 + amt / 900); }
    if (e.kind === 'tower' && e.sub === 'king' && !e.active) { e.active = true; }
    if (e.hp <= 0) kill(e, src);
  }
  function kill(e, src, quiet) {
    e.alive = false; e.hp = 0;
    if (quiet) return;
    if (e.kind === 'tower') {
      const other = 1 - e.team;
      if (e.sub === 'king') { G.crowns[other] = 3; towerBlast(e, 3.2); B.sfx('tower'); G.shake = 0.9; end(); }
      else {
        G.crowns[other] = Math.min(3, G.crowns[other] + 1);
        const k = G.ents.find(t => t.alive && t.kind === 'tower' && t.sub === 'king' && t.team === e.team); if (k) k.active = true;
        towerBlast(e, 2.5); B.sfx('tower'); G.shake = 0.55;
        say(other === 0 ? 'Tower down!' : 'You lost a tower', 1.6, other === 0 ? '#7ff' : '#f98');
        if (G.overtime) end();
      }
      G.decals.push({ x: e.x, y: e.y, sub: e.sub, team: e.team });
    } else {
      const big = e.maxHp > 1500; explode(e.x, e.y + 0.01, e.r * 1.3 + 0.45, { z: e.air ? 1.6 : 0.5, debris: big ? 22 : e.kind === 'building' ? 16 : 9, big, shake: big ? 0.25 : 0, col: TCOL(e.team)[0], scorch: !e.air });
      B.sfx('boom');
    }
  }

  function boom(x, y, r, col, n) { explode(x, y, r, { sparks: n, col }); }
  // Layered fireball + shock ring + sparks + smoke + flying debris + a scorch mark that fades.
  function explode(x, y, r, o = {}) {
    if (G.sim) return;
    const col = o.col || '#ffb347', z = o.z == null ? 0.4 : o.z, d = o.delay || 0;
    G.fx.push({ type: 'fireball', x, y, z, r, t: -d, dur: 0.5 + r * 0.12, seed: Math.random() * 100 });
    G.fx.push({ type: 'flash', x, y, z, r: r * 1.3, t: -d, dur: 0.16 });
    G.fx.push({ type: 'ring', x, y, R: r * 1.7, t: -d, dur: 0.38, col: '#ffe2a8' });
    const n = o.sparks == null ? Math.round(10 + r * 8) : o.sparks;
    for (let i = 0; i < n; i++) {
      const a = rnd(0, 6.283), sp = rnd(2, 7) * (0.5 + r * 0.4);
      G.fx.push({ type: 'spark', x, y, z: z + rnd(0, 0.4), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rnd(2, 7), t: -d, dur: rnd(0.3, 0.8), col: i % 3 ? col : '#fff4c8', size: rnd(0.05, 0.11) });
    }
    for (let i = 0; i < 4 + r * 3; i++) G.fx.push({ type: 'smoke', x: x + rnd(-r, r) * 0.5, y: y + rnd(-r, r) * 0.4, z: z + rnd(0, 0.5), t: -d - rnd(0.05, 0.25), dur: rnd(1.0, 1.9), size: rnd(0.45, 0.85) * (0.6 + r * 0.5), vz: rnd(0.6, 1.4) });
    const deb = o.debris || 0;
    for (let i = 0; i < deb; i++) {
      const a = rnd(0, 6.283), sp = rnd(1.5, 5);
      G.fx.push({ type: 'debris', x, y, z: z + 0.3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rnd(3, 8), rot: rnd(0, 6), vr: rnd(-14, 14), w: rnd(0.08, 0.22) * (o.big ? 1.6 : 1), h: rnd(0.05, 0.14) * (o.big ? 1.6 : 1),
        col: ['#3a3f48', '#5b636e', '#2a2e35', '#8d939c'][i % 4], t: -d, dur: rnd(1.0, 1.6) });
    }
    if (o.scorch !== false) G.scorch.push({ x, y, r: r * 0.95, t: -d, dur: 9 });
    if (o.shake) setTimeout(() => { if (G) G.shake = Math.max(G.shake, o.shake); }, d * 1000);
  }
  function towerBlast(e, r) {
    G.hitstop = 0.12;
    explode(e.x, e.y, r, { z: 1.2, debris: 34, big: true, shake: 0.5 });
    for (let k = 0; k < 3; k++) explode(e.x + rnd(-1.2, 1.2), e.y + rnd(-0.8, 0.8), r * 0.55, { z: rnd(0.8, 2.2), delay: 0.15 + k * 0.17, debris: 6, scorch: false });
  }
  function sparksAt(x, y, z, n, col, sp = 3) {
    if (G.sim) return;
    for (let i = 0; i < n; i++) { const a = rnd(0, 6.283), v = rnd(1, sp); G.fx.push({ type: 'spark', x, y, z, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: rnd(1, 4), t: 0, dur: rnd(0.2, 0.45), col, size: rnd(0.04, 0.09) }); }
  }

  function attack(u, e) {
    u.atkT = 0; u.anim = 'attack';
    let amt = u.dmg, charged = false;
    if (u.charging) { amt *= 2; charged = true; u.charging = false; u.moved = 0; }
    if (u.kind === 'tower') { u.shotN = (u.shotN || 0) + 1; shoot(u, e, 'tower', amt); u.fireT = 0; B.sfx('shell'); return; }
    if (u.c.beam) return;   // the beam deals damage continuously
    u.pend = { e, at: ((IMPACT[u.c.sprite] == null ? 1 : IMPACT[u.c.sprite]) + 0.5) * FD, amt, charged };
    if (G.sim) resolve(u);
  }
  // The hit lands on the animation's impact frame.
  function resolve(u) {
    const p = u.pend; u.pend = null; const e = p.e, c = u.c, tc = TCOL(u.team);
    if (c.kamikaze) {   // Boom Bot: blow up on contact
      blast(u.team, u.x + Math.cos(u.face) * u.r, u.y + Math.sin(u.face) * u.r, c.splash, p.amt, 'ground', u); u.hp = 0; kill(u, null, true); return;
    }
    if (c.proj === 'rail') return railShot(u, e, p.amt);
    if (c.proj === 'chain') return chainShot(u, e, p.amt);
    if (c.proj) { if (e.alive) { shoot(u, e, c.proj, p.amt); B.sfx(c.proj === 'laser' || c.proj === 'minimissile' ? 'laser' : 'shell'); } return; }
    if (!e.alive || gap(u, e) > u.range + 0.8) return;
    damage(e, p.amt, u); B.sfx('hit');
    if (G.sim) return;
    const a = Math.atan2(e.y - u.y, e.x - u.x), hx = e.x - Math.cos(a) * e.r * 0.7, hy = e.y - Math.sin(a) * e.r * 0.7, hz = e.air ? 1.8 : e.kind === 'tower' ? 1.2 : 0.7;
    const sp = c.sprite;
    if (sp === 'sentinel') { G.fx.push({ type: 'slash', x: u.x, y: u.y, a: u.face, r: u.r + 1.05, t: 0, dur: 0.24, col: tc }); sparksAt(hx, hy, hz, 10, tc[1], 4); G.fx.push({ type: 'glow', x: hx, y: hy, z: hz, r: 0.7, t: 0, dur: 0.18, col: tc[2] }); }
    else if (sp === 'titan') {
      const fx = u.x + Math.cos(u.face) * (u.r + 0.5), fy = u.y + Math.sin(u.face) * (u.r + 0.5);
      G.fx.push({ type: 'ring', x: fx, y: fy, R: 2.6, t: 0, dur: 0.45, col: '#ffe0b0' }); G.fx.push({ type: 'ring', x: fx, y: fy, R: 1.6, t: -0.05, dur: 0.35, col: '#ffffff' });
      for (let i = 0; i < 12; i++) { const aa = i / 12 * 6.283; G.fx.push({ type: 'dust', x: fx + Math.cos(aa) * 0.6, y: fy + Math.sin(aa) * 0.6, vx: Math.cos(aa) * 2.4, vy: Math.sin(aa) * 2.4, z: 0.1, t: 0, dur: rnd(0.7, 1.1), size: rnd(0.4, 0.7) }); }
      for (let i = 0; i < 8; i++) G.fx.push({ type: 'debris', x: fx, y: fy, z: 0.1, vx: rnd(-3, 3), vy: rnd(-3, 3), vz: rnd(3, 6), rot: rnd(0, 6), vr: rnd(-12, 12), w: rnd(0.06, 0.14), h: rnd(0.05, 0.1), col: '#4a4f58', t: 0, dur: 0.9 });
      G.scorch.push({ x: fx, y: fy, r: 1.0, t: 0, dur: 5, crack: true }); G.shake = Math.max(G.shake, 0.32); G.hitstop = 0.07; B.sfx('boom');
    }
    else if (sp === 'hound') {
      G.fx.push({ type: 'zap', x1: u.x + Math.cos(u.face) * u.r, y1: u.y + Math.sin(u.face) * u.r, x2: hx, y2: hy, z: hz, t: 0, dur: 0.22, col: p.charged ? '#fff27a' : tc[0] });
      sparksAt(hx, hy, hz, p.charged ? 18 : 8, p.charged ? '#fff27a' : tc[1], 5);
      if (p.charged) { G.fx.push({ type: 'ring', x: e.x, y: e.y, R: 1.8, t: 0, dur: 0.35, col: '#fff27a' }); G.shake = Math.max(G.shake, 0.18); G.hitstop = 0.06; B.sfx('zap'); }
    }
    else if (sp === 'spider') { G.fx.push({ type: 'zap', x1: u.x, y1: u.y, x2: hx, y2: hy, z: hz * 0.6, t: 0, dur: 0.14, col: tc[0], thin: true }); sparksAt(hx, hy, hz, 4, tc[1], 2.5); }
    else sparksAt(hx, hy, hz, 8, tc[1], 3);
  }
  // splash damage at a point (bombs, mortar shells, boom bots)
  function blast(team, x, y, r, amt, targets, src) {
    for (const o of G.ents) {
      if (!o.alive || o.team === team) continue;
      if (targets === 'ground' && o.air) continue;
      if (Math.hypot(o.x - x, o.y - y) <= r + o.r * 0.5) damage(o, o.kind === 'tower' ? Math.round(amt * 0.8) : amt, src);
    }
    explode(x, y, r * 0.95, { debris: 10, shake: 0.18, big: r > 1.4 }); B.sfx('boom'); if (!G.sim) G.hitstop = Math.max(G.hitstop || 0, 0.04);
  }
  // Rail Lancer: one shot that pierces everything along a straight line
  function railShot(u, e, amt) {
    const a = Math.atan2(e.y - u.y, e.x - u.x), x0 = u.x + Math.cos(a) * (u.r + 0.4), y0 = u.y + Math.sin(a) * (u.r + 0.4);
    const L = u.c.pierce, x1 = x0 + Math.cos(a) * L, y1 = y0 + Math.sin(a) * L;
    for (const o of G.ents) {
      if (!o.alive || o.team === u.team || !canHit(u, o)) continue;
      const t = clamp(((o.x - x0) * Math.cos(a) + (o.y - y0) * Math.sin(a)) / L, 0, 1);
      const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
      if (Math.hypot(o.x - px, o.y - py) <= o.r + 0.35) { damage(o, amt, u); if (!G.sim) sparksAt(o.x, o.y, o.air ? 1.8 : 0.9, 10, TCOL(u.team)[1], 5); }
    }
    B.sfx('zap'); if (G.sim) return;
    G.fx.push({ type: 'rail', x1: x0, y1: y0, x2: x1, y2: y1, z: 1.5, t: 0, dur: 0.38, col: TCOL(u.team) });
    G.fx.push({ type: 'glow', x: x0, y: y0, z: 1.5, r: 1.0, t: 0, dur: 0.18, col: TCOL(u.team)[2] }); G.shake = Math.max(G.shake, 0.12);
  }
  // Arc Trooper: lightning that jumps from the target to more enemies
  function chainShot(u, e, amt) {
    if (!e.alive) return;
    const hit = [e]; let cur = e, pts = [[u.x + Math.cos(u.face) * u.r, u.y + Math.sin(u.face) * u.r, 1.6]], k = 1;
    damage(e, amt, u); pts.push([e.x, e.y, e.air ? 1.8 : 0.9]);
    for (let j = 0; j < u.c.chain; j++) {
      let nx = null, nd = 3.3;
      for (const o of G.ents) { if (!o.alive || o.team === u.team || hit.includes(o) || !canHit(u, o)) continue; const d = Math.hypot(o.x - cur.x, o.y - cur.y); if (d < nd) { nd = d; nx = o; } }
      if (!nx) break; k *= 0.7; damage(nx, Math.round(amt * k), u); hit.push(nx); cur = nx; pts.push([nx.x, nx.y, nx.air ? 1.8 : 0.9]);
    }
    B.sfx('zap'); if (G.sim) return;
    G.fx.push({ type: 'chain', pts, t: 0, dur: 0.32, col: TCOL(u.team) });
    for (const o of hit) sparksAt(o.x, o.y, o.air ? 1.8 : 0.9, 6, '#ffffff', 3);
  }
  function shoot(u, e, kind, amt) {
    const tower = u.kind === 'tower';
    const z0 = tower ? (u.sub === 'king' ? 3.0 : 2.3) : u.air ? (kind === 'bomb' ? 1.3 : 1.75) : ({ rocket: 2.0, shell: 0.9, laser: 1.0, mortar: 1.6 })[kind] || 1;
    const fwd = tower ? u.r * 0.9 : u.r * US * 0.9 + (kind === 'laser' ? 0.4 : 0.2);
    const spd = { laser: 17, shell: 12, rocket: 9, tower: 14, minimissile: 11, mortar: 7, bomb: 4 }[kind];
    const x = u.x + Math.cos(u.face) * fwd, y = u.y + Math.sin(u.face) * fwd;
    const pr = { kind, team: u.team, x, y, z: z0, tgt: e, tx: e.x, ty: e.y, spd, dmg: amt, splash: u.c && u.c.splash || 0, src: u, targets: u.targets === 'buildings' ? 'ground' : u.targets, trail: [], age: 0 };
    if (kind === 'mortar' || kind === 'bomb') {   // lobbed / dropped: fixed landing point, flight time
      pr.sx = x; pr.sy = y; pr.sz = z0; pr.tgt = null; pr.dur = kind === 'bomb' ? 0.45 : Math.max(0.8, Math.hypot(e.x - x, e.y - y) / 6.5);
      if (kind === 'bomb') { pr.sx = pr.x = e.x; pr.sy = pr.y = e.y - 0.01; }
      if (!G.sim) G.fx.push({ type: 'target', x: e.x, y: e.y, R: pr.splash, t: 0, dur: pr.dur, col: TCOL(u.team)[0] });
    }
    G.proj.push(pr);
    if (!G.sim) G.fx.push({ type: 'glow', x, y, z: z0, r: kind === 'rocket' ? 0.9 : tower ? 0.8 : 0.55, t: 0, dur: 0.12, col: kind === 'rocket' || kind === 'shell' || tower ? '255,190,90' : TCOL(u.team)[2] });
  }

  // ---------------- step ----------------
  function step(dt) {
    G.t += dt;
    G.time -= dt;
    if (!G.overtime && G.time <= 0) {
      if (G.crowns[0] !== G.crowns[1]) return end();
      G.overtime = true; G.time = CB.OVERTIME_SECS; say('Overtime! Next tower wins', 2.2, '#ffd36a');
    } else if (G.overtime && G.time <= 0) return end();
    const mult = G.overtime ? 3 : G.time <= CB.DOUBLE_AT ? 2 : 1;
    if (!G.overtime && G.time <= CB.DOUBLE_AT && G.time + dt > CB.DOUBLE_AT) say('Double energy!', 1.8, '#d9a0ff');
    for (const tm of [0, 1]) G.energy[tm] = Math.min(CB.ENERGY_MAX, G.energy[tm] + CB.ENERGY_RATE * mult * dt * (tm ? (G.opt.enemy.emul || 1) : 1));

    for (const u of G.ents) if (u.alive) think(u, dt);
    separate(dt);
    for (const p of G.proj) moveProj(p, dt);
    G.proj = G.proj.filter(p => !p.done);
    for (const s of G.spells || []) stepSpell(s, dt);
    if (G.spells) G.spells = G.spells.filter(s => !s.done);
    G.ents = G.ents.filter(e => e.alive || e.kind === 'tower');
    aiStep(dt);
  }

  function think(u, dt) {
    u.flash = Math.max(0, u.flash - dt); u.atkT += dt;
    if (u.kind === 'tower') return thinkTower(u, dt);
    if (u.deploy > 0) { u.deploy -= dt; return; }
    if (u.stun > 0) { u.stun -= dt; u.anim = 'idle'; u.beamT = 0; u.pend = null; return; }
    if (u.kind === 'building') { u.hp -= u.maxHp / u.life * dt; if (u.hp <= 0) return kill(u); }
    if (u.slowT > 0) u.slowT -= dt;
    if (u.c.spawn) {   // Drone Hive: launch drones on a timer
      u.spawnT = (u.spawnT == null ? 0.6 : u.spawnT) - dt;
      if (u.spawnT <= 0) {
        u.spawnT = u.hit; u.atkT = 0; u.anim = 'attack';
        for (let k = 0; k < u.c.spawn.n; k++) {
          const d = mkUnit(u.team, u.c.spawn.id, u.lvl, u.x + (k ? 0.45 : -0.45), u.y + (u.team ? 0.7 : -0.7)); d.deploy = 0.25; G.ents.push(d);
          if (!G.sim) { sparksAt(d.x, d.y, 0.9, 6, TCOL(u.team)[1], 3); G.fx.push({ type: 'glow', x: d.x, y: d.y, z: 0.9, r: 0.6, t: 0, dur: 0.2, col: TCOL(u.team)[2] }); }
        }
      }
      return;
    }
    if (u.c.heal) return thinkMedic(u, dt);
    if (u.pend && u.atkT >= u.pend.at) resolve(u);
    u.retarget -= dt; u.cd -= dt * (u.slowT > 0 ? 0.6 : 1);
    const t = u.target;
    if (!t || !t.alive || u.retarget <= 0 && !u.locked || (t && !t.alive)) { u.target = findTarget(u); u.retarget = 0.3; u.locked = false; }
    const e = u.target;
    if (!e) { u.anim = 'idle'; return; }
    const g = gap(u, e);
    if (u.c.minRange && g < u.c.minRange && e.kind === 'troop') { u.target = null; u.locked = false; }
    if (g <= u.range && u.target) {
      u.locked = true;
      u.face = turn(u.face, Math.atan2(e.y - u.y, e.x - u.x), dt * 10);
      if (u.c.beam) return beam(u, e, dt);
      if (u.c.cone) return flame(u, e, dt);
      if (u.cd <= 0 && !u.pend) { attack(u, e); u.cd = u.hit; }
      else if (u.atkT > FD * 6) u.anim = 'idle';
      u.moved = 0; u.charging = false;
      return;
    }
    u.locked = false; u.beamT = 0;
    if (u.kind === 'building') { u.anim = 'idle'; u.target = null; return; }
    if (u.pend || u.atkT < FD * 5) return;   // finish the swing
    const [wx, wy] = waypoint(u, e.x, e.y);
    const a = Math.atan2(wy - u.y, wx - u.x);
    let sp = u.speed * (u.charging ? 2 : 1) * (u.slowT > 0 ? 1 - (u.slowAmt || 0.4) : 1);
    u.x += Math.cos(a) * sp * dt; u.y += Math.sin(a) * sp * dt; u.moved += sp * dt;
    if (u.c.charge && !u.charging && u.moved > 2) { u.charging = true; B.sfx('zap'); }
    u.face = turn(u.face, a, dt * 8); u.anim = 'walk'; u.walkPh += dt * sp / 1.4;
  }
  function turn(a, b, k) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + clamp(d, -k, k); }

  function beam(u, e, dt) {
    if (u.beamTarget !== e) { u.beamTarget = e; u.beamT = 0; }
    u.beamT += dt; u.anim = 'attack'; u.atkT = 0.1;
    u.cd -= 0; if (u.cd <= 0) {
      const st = u.c.ramp ? (u.beamT < 2 ? 0 : u.beamT < 4 ? 1 : 2) : 0;
      damage(e, Math.round((u.c.ramp ? u.c.ramp[st] : u.c.dmg) * CB.LVL_MUL(u.lvl)), u); u.cd = u.hit;
      if (u.c.frost) {   // slow the target and everyone around it
        for (const o of G.ents) if (o.alive && o.team !== u.team && o.kind !== 'tower' && Math.hypot(o.x - e.x, o.y - e.y) <= u.c.frost.r + o.r) { o.slowT = u.c.frost.t; o.slowAmt = u.c.frost.slow; }
        if (!G.sim) { G.fx.push({ type: 'ring', x: e.x, y: e.y, R: u.c.frost.r, t: 0, dur: 0.4, col: '#bff4ff' }); for (let i = 0; i < 4; i++) G.fx.push({ type: 'spark', x: e.x + rnd(-0.8, 0.8), y: e.y + rnd(-0.6, 0.6), z: rnd(0.2, 1.2), vx: 0, vy: 0, vz: -0.5, t: 0, dur: 0.6, col: '#e8fbff', size: 0.07 }); }
      }
      B.sfx('beam');
      G.fx.push({ type: 'spark', x: e.x, y: e.y, z: e.air ? 1.8 : 0.7, vx: rnd(-2, 2), vy: rnd(-2, 2), vz: rnd(1, 3), t: 0, dur: 0.3, col: '#ffe08a', size: 0.08 + st * 0.03 });
    }
  }

  // Scorcher: a cone of flame in front of it; everything inside burns
  function flame(u, e, dt) {
    u.anim = 'attack'; u.atkT = 0.1; u.flaming = 0.2;
    if (!G.sim) for (let i = 0; i < 3; i++) {
      const a = u.face + rnd(-u.c.cone.a, u.c.cone.a) * 0.8, sp = rnd(4.5, 7);
      G.fx.push({ type: 'flamep', x: u.x + Math.cos(u.face) * (u.r + 0.5), y: u.y + Math.sin(u.face) * (u.r + 0.5), z: 0.65, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, dur: u.c.cone.r / sp * 1.15, size: rnd(0.25, 0.4) });
    }
    if (u.cd > 0) return;
    u.cd = u.hit; const amt = Math.round(u.c.dmg * CB.LVL_MUL(u.lvl));
    for (const o of G.ents) {
      if (!o.alive || o.team === u.team || o.air) continue;
      const d = Math.hypot(o.x - u.x, o.y - u.y); if (d - o.r > u.c.cone.r + u.r) continue;
      let da = Math.atan2(o.y - u.y, o.x - u.x) - u.face; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      if (Math.abs(da) <= u.c.cone.a + o.r / Math.max(0.5, d)) damage(o, amt, u);
    }
    B.sfx('beam');
  }

  function thinkMedic(u, dt) {
    u.healT -= dt;
    if (u.healT <= 0) {
      u.healT = u.hit; let any = false;
      for (const a of G.ents) {
        if (!a.alive || a.team !== u.team || a.kind === 'tower' || a.kind === 'building') continue;
        if (dist(a, u) <= u.c.healR + a.r && a.hp < a.maxHp) { a.hp = Math.min(a.maxHp, a.hp + u.c.heal * CB.LVL_MUL(u.lvl)); any = true; }
      }
      if (any) { G.fx.push({ type: 'ring', x: u.x, y: u.y, r: 0, R: u.c.healR, t: 0, dur: 0.6, col: '#5dff8a' }); u.anim = 'attack'; u.atkT = 0; B.sfx('heal'); }
    }
    // follow the nearest friend that is closer to the enemy, else walk toward the enemy with a safe gap
    let lead = null, ld = 1e9;
    for (const a of G.ents) {
      if (!a.alive || a.team !== u.team || a === u || a.kind !== 'troop' || a.c.heal) continue;
      const d = dist(a, u); if (d < ld) { ld = d; lead = a; }
    }
    let tx, ty;
    if (lead) { tx = lead.x; ty = lead.y + (u.team ? -1.2 : 1.2); if (ld < 1.6) { u.anim = u.atkT < 0.5 ? 'attack' : 'idle'; return; } }
    else { const t = laneTower(u); if (!t) return; if (gap(u, t) < 4) { u.anim = 'idle'; return; } tx = t.x; ty = t.y; }
    const [wx, wy] = waypoint(u, tx, ty); const a = Math.atan2(wy - u.y, wx - u.x);
    u.x += Math.cos(a) * u.speed * dt; u.y += Math.sin(a) * u.speed * dt;
    u.face = turn(u.face, a, dt * 6); if (u.atkT > 0.5) u.anim = 'walk'; u.walkPh += dt * u.speed / 1.4;
  }

  function thinkTower(u, dt) {
    u.fireT += dt;
    if (!u.alive || !u.active) return;
    u.cd -= dt;
    if (!u.target || !u.target.alive || gap(u, u.target) > u.range) {
      u.target = null; let bd = 1e9;
      for (const e of G.ents) { if (!e.alive || e.team === u.team || e.kind === 'tower') continue; const g = gap(u, e); if (g <= u.range && g < bd) { bd = g; u.target = e; } }
    }
    if (u.target) { u.face = turn(u.face, Math.atan2(u.target.y - u.y, u.target.x - u.x), dt * 6); if (u.cd <= 0) { attack(u, u.target); u.cd = u.hit; } }
  }

  function separate(dt) {
    const es = G.ents.filter(e => e.alive);
    for (let i = 0; i < es.length; i++) {
      const a = es[i];
      for (let j = i + 1; j < es.length; j++) {
        const b = es[j];
        if (a.air !== b.air) continue;
        const sa = a.kind === 'tower' || a.kind === 'building', sb = b.kind === 'tower' || b.kind === 'building';
        if (sa && sb) continue;
        const dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 0.001; const ov = a.r + b.r - d;
        if (ov <= 0) continue;
        const nx = dx / d, ny = dy / d;
        const ma = sa ? 1e9 : a.mass, mb = sb ? 1e9 : b.mass; const tot = ma + mb;
        const push = Math.min(ov, 3 * dt + ov * 0.5);
        if (!sa) { a.x -= nx * push * mb / tot; a.y -= ny * push * mb / tot; }
        if (!sb) { b.x += nx * push * ma / tot; b.y += ny * push * ma / tot; }
      }
    }
    for (const u of es) {
      if (u.kind !== 'troop') continue;
      u.x = clamp(u.x, 0.3, W - 0.3); u.y = clamp(u.y, 0.3, H - 0.3);
      if (!u.air && u.y > R0 && u.y < R1) {   // keep walkers on the bridges
        const br = CB.BRIDGES.reduce((p, b) => Math.abs((b[0] + b[1]) / 2 - u.x) < Math.abs((p[0] + p[1]) / 2 - u.x) ? b : p);
        if (u.x < br[0] + 0.3 || u.x > br[1] - 0.3) {
          const inside = clamp(u.x, br[0] + 0.3, br[1] - 0.3);
          if (Math.abs(inside - u.x) < 1.2) u.x = inside; else u.y = u.y < MIDY ? R0 - 0.01 : R1 + 0.01;
        }
      }
    }
  }

  function moveProj(p, dt) {
    if (p.dur) {   // lobbed mortar shell or falling bomb
      p.age += dt; const k = Math.min(1, p.age / p.dur);
      p.x = p.sx + (p.tx - p.sx) * k; p.y = p.sy + (p.ty - p.sy) * k;
      p.z = p.kind === 'bomb' ? p.sz * (1 - k * k) : p.sz * (1 - k) + Math.sin(k * Math.PI) * Math.max(2.5, p.dur * 3.5);
      if (!G.sim && p.kind === 'mortar' && Math.random() < 0.6) G.fx.push({ type: 'smoke', x: p.x, y: p.y, z: p.z, t: 0, dur: 0.6, size: 0.18, vz: 0.2, light: true });
      if (k >= 1) { p.done = true; blast(p.team, p.tx, p.ty, p.splash, p.dmg, p.targets, p.src); }
      return;
    }
    if (p.tgt && p.tgt.alive) { p.tx = p.tgt.x; p.ty = p.tgt.y; }
    const tz = p.tgt && p.tgt.air ? 1.8 : p.tgt && p.tgt.kind === 'tower' ? 1.4 : 0.6;
    const dx = p.tx - p.x, dy = p.ty - p.y, dz = tz - p.z; const d = Math.hypot(dx, dy, dz);
    p.trail.push([p.x, p.y, p.z]); if (p.trail.length > (p.kind === 'rocket' ? 10 : 4)) p.trail.shift();
    const s = p.spd * dt;
    if (d <= s) {
      p.done = true;
      if (p.splash) {
        for (const e of G.ents) {
          if (!e.alive || e.team === p.team) continue;
          if (p.targets === 'ground' && e.air) continue;
          if (Math.hypot(e.x - p.tx, e.y - p.ty) <= p.splash + e.r * 0.5) damage(e, p.dmg, p.src);
        }
        explode(p.tx, p.ty, p.splash * 0.9, { z: tz * 0.5, debris: 5, shake: 0.1 }); B.sfx('boom');
      } else {
        if (p.tgt && p.tgt.alive) damage(p.tgt, p.dmg, p.src);
        if (!G.sim) { const col = p.kind === 'laser' ? TCOL(p.team) : ['#ffb347', '#fff0c0', '255,180,80']; sparksAt(p.tx, p.ty, tz, p.kind === 'tower' ? 9 : 6, col[1], 3); G.fx.push({ type: 'glow', x: p.tx, y: p.ty, z: tz, r: p.kind === 'tower' ? 0.8 : 0.5, t: 0, dur: 0.14, col: col[2] }); }
      }
      return;
    }
    p.x += dx / d * s; p.y += dy / d * s; p.z += dz / d * s;
    p.age += dt;
    if (p.kind === 'rocket' || p.kind === 'minimissile') { p.z += Math.sin(Math.min(1, p.age * 3)) * dt * 1.2; if (!G.sim && Math.random() < 0.8) G.fx.push({ type: 'smoke', x: p.x, y: p.y, z: p.z, t: 0, dur: rnd(0.5, 0.9), size: rnd(0.14, 0.24), vz: 0.3, light: true }); }
  }

  // ---------------- playing cards ----------------
  function validSpot(team, card, x, y) {
    const c = CB.CARDS[card];
    if (c.type === 'spell') return x >= 0 && x <= W && y >= 0 && y <= H;
    if (x < 0.5 || x > W - 0.5) return false;
    const own = team === 0 ? y >= R1 + 0.5 && y <= H - 0.5 : y <= R0 - 0.5 && y >= 0.5;
    if (own) return true;
    // after knocking down a lane tower you may deploy a few tiles into that lane
    const lane = x < W / 2 ? 0 : 1;
    const down = G.ents.find(e => e.kind === 'tower' && e.sub === 'guard' && e.team !== team && e.lane === lane && !e.alive);
    if (!down) return false;
    return team === 0 ? y >= R0 - 4.5 && y <= R0 : y <= R1 + 4.5 && y >= R1;
  }
  B.validSpot = (card, x, y) => G && validSpot(0, card, x, y);
  B.playAny = (team, card, x, y) => G && play(team, card, x, y);   // used by the automated playtests

  function play(team, card, x, y) {
    const c = CB.CARDS[card]; const lvl = G.lvls[team][card] || 1;
    if (G.energy[team] < c.cost || !validSpot(team, card, x, y)) return false;
    G.energy[team] -= c.cost;
    if (G.sim) { G.played = G.played || {}; const k = team + ':' + card; G.played[k] = (G.played[k] || 0) + 1; }
    const dk = G.deck[team]; const i = dk.indexOf(card); dk.splice(i, 1); dk.push(card);
    if (c.type === 'spell') castSpell(team, card, lvl, x, y);
    else {
      // keep clear of tower bodies
      for (const e of G.ents) if (e.alive && e.kind === 'tower') { const d = Math.hypot(x - e.x, y - e.y); const need = e.r + c.radius; if (d < need) { const a = Math.atan2(y - e.y, x - e.x) || (team ? 1.57 : -1.57); x = e.x + Math.cos(a) * need; y = e.y + Math.sin(a) * need; } }
      const n = c.count;
      for (let k = 0; k < n; k++) {
        let ox = 0, oy = 0;
        if (n > 1) { const a = k / n * Math.PI * 2 + 0.4; const rr = n > 3 ? 0.75 : 0.5; ox = Math.cos(a) * rr; oy = Math.sin(a) * rr; }
        const u = mkUnit(team, card, lvl, clamp(x + ox, 0.4, W - 0.4), clamp(y + oy, 0.4, H - 0.4));
        u.deploy = 1 + k * 0.05; G.ents.push(u);
      }
      G.fx.push({ type: 'ring', x, y, r: 0, R: 1.2 + c.radius, t: 0, dur: 0.5, col: team ? '#ff9a4a' : '#5fe8ff' });
      G.fx.push({ type: 'beamdown', x, y, t: 0, dur: 0.7, col: team ? '#ffb06a' : '#7ff0ff', r: c.radius + 0.4 });
      sparksAt(x, y, 0.2, 14, team ? '#ffd0a0' : '#c8fbff', 4);
    }
    if (team === 0) B.sfx('deploy');
    return true;
  }

  function castSpell(team, card, lvl, x, y) {
    const c = CB.CARDS[card]; G.spells = G.spells || [];
    if (card === 'missile') {
      const k = G.ents.find(e => e.kind === 'tower' && e.sub === 'king' && e.team === team);
      G.spells.push({ card, team, lvl, x, y, sx: k.x, sy: k.y, t: 0, dur: 1.0 });
    } else G.spells.push({ card, team, lvl, x, y, t: 0, dur: 0.35 });
  }
  function stepSpell(s, dt) {
    s.t += dt;
    if (s.t < s.dur) return;
    s.done = true; const c = CB.CARDS[s.card]; const amt = Math.round(c.dmg * CB.LVL_MUL(s.lvl));
    for (const e of G.ents) {
      if (!e.alive || e.team === s.team) continue;
      if (Math.hypot(e.x - s.x, e.y - s.y) > c.radius + e.r * 0.6) continue;
      damage(e, e.kind === 'tower' ? Math.round(amt * c.towerPct) : amt);
      if (c.stun && e.kind !== 'tower') { e.stun = Math.max(e.stun || 0, c.stun); e.charging = false; e.moved = 0; e.beamT = 0; }
      if (c.stun && e.kind === 'tower') e.cd = Math.max(e.cd, c.stun);
      if (c.knock && e.kind === 'troop' && e.mass < 10 && e.alive) { const a = Math.atan2(e.y - s.y, e.x - s.x); e.x += Math.cos(a) * c.knock; e.y += Math.sin(a) * c.knock; }
    }
    if (s.card === 'missile') { explode(s.x, s.y, c.radius * 0.95, { debris: 18, big: true, shake: 0.4 }); G.hitstop = 0.08; B.sfx('boom'); }
    else { G.fx.push({ type: 'emp', x: s.x, y: s.y, R: c.radius, t: 0, dur: 0.6 }); B.sfx('zap'); }
  }

  // ---------------- the computer opponent ----------------
  // Watches what crosses toward its side, answers with a sensible counter, and pushes when it has energy to spare.
  function aiStep(dt) { aiTeam(1, G.ai, dt); if (G.ai0) aiTeam(0, G.ai0, dt); }
  // tm = the side it plays. All positions are worked out as if it sat at the top (y small) and mirrored for the bottom.
  function aiTeam(tm, ai, dt) {
    ai.think -= dt;
    if (ai.think > 0) return;
    const skill = ai.lvl;   // 0..1
    ai.think = rnd(0.5, 1.1) * (1.4 - skill * 0.6);
    const Y = y => tm ? y : H - y;          // top-side y -> real y
    const hand = G.deck[tm].slice(0, 4); const en = G.energy[tm];
    const foes = G.ents.filter(e => e.alive && e.team !== tm && e.kind === 'troop');
    const threats = foes.filter(e => Y(e.y) < 21);
    const cost = id => CB.CARDS[id].cost;
    const has = id => hand.includes(id) && en >= cost(id);
    const pick = list => list.find(has);
    const go = (card, x, y) => play(tm, card, x, Y(y));

    // 1) spells on clumps
    for (const sp of ['missile', 'emp']) {
      if (!has(sp)) continue;
      const c = CB.CARDS[sp];
      let best = null, bv = 0;
      for (const f of foes) {
        let v = 0;
        for (const g of foes) if (Math.hypot(g.x - f.x, g.y - f.y) < c.radius) v += CB.CARDS[g.card].cost / CB.CARDS[g.card].count;
        if (f.c.beam && sp === 'emp') v += 3;
        if (v > bv) { bv = v; best = f; }
      }
      if (best && bv >= cost(sp) + (sp === 'missile' ? 1 : 0.5) && Math.random() < 0.5 + skill * 0.5) {
        const lead = Y(best.y) < 21 ? 0.6 : 0.2;
        if (go(sp, best.x, Y(best.y) - lead * best.speed)) return;
      }
    }

    // 2) defend
    if (threats.length) {
      const hp = threats.reduce((s, t) => s + t.hp, 0);
      const front = threats.reduce((a, b) => Y(a.y) < Y(b.y) ? a : b); const fy = Y(front.y);
      const air = threats.some(t => t.air), swarm = threats.filter(t => t.c.count >= 3 && !t.air).length >= 3, big = threats.some(t => t.maxHp > 1800);
      const tower = threats.some(t => t.targets === 'buildings');
      let card = null;
      if (air) card = pick(['blaster', 'jet', 'arc', 'rail', 'rocket', 'cryo', 'hive', 'colossus']);
      if (!card && swarm) card = pick(['scorcher', 'arc', 'rocket', 'emp', 'bombard', 'sentinel', 'colossus']);
      if (!card && big) card = pick(['spider', 'cryo', 'rail', 'colossus', 'turret', 'hound', 'sentinel', 'blaster']);
      if (!card && tower) card = pick(['turret', 'hive', 'spider', 'sentinel', 'scorcher']);
      if (!card) card = pick(['sentinel', 'hound', 'blaster', 'arc', 'jet', 'spider', 'cryo', 'rocket', 'turret', 'scorcher', 'titan']);
      if (card && hp > 150) {
        const c = CB.CARDS[card]; let x, y;
        if (c.type === 'building') { x = clamp(front.x * 0.4 + 9 * 0.6, 6, 12); y = 7.5; }
        else if (card === 'bombard') { x = clamp(front.x, 3, 15); y = 3; }
        else if (c.range > 3) { x = clamp(front.x, 2, 16); y = clamp(fy - 5.5, 2, 13); }
        else { x = clamp(front.x + rnd(-1, 1), 1, 17); y = clamp(fy - 2.5, 2, 13.5); }
        if (go(card, x, y)) return;
      }
      if (en < 9.5) return;
    }

    // 3) attack when energy is high
    if (en >= 8.5 - skill * 1.5 || (en >= 6 && Math.random() < 0.05)) {
      const lane = pickLane(tm);
      const lx = lane ? 14.5 : 3.5;
      const tank = pick(['titan', 'bomber', 'colossus', 'scorcher', 'cryo', 'sentinel', 'hound']);
      if (tank) {
        const behind = tank === 'titan' || tank === 'colossus' || tank === 'bomber';
        if (go(tank, lx + rnd(-0.5, 0.5), behind ? rnd(9, 13) : rnd(11, 13.5))) { ai.follow = { lane: lx, t: 2.5 }; return; }
      }
      const any = pick(['rocket', 'boombot', 'blaster', 'arc', 'jet', 'rail', 'spider', 'medic', 'hound', 'sentinel']);
      if (any && en >= 9.5) { go(any, lx + rnd(-1, 1), rnd(10, 13)); return; }
    }
    // support a push that just went out
    if (ai.follow && (ai.follow.t -= 1) < 0) {
      const sup = pick(['medic', 'rocket', 'bombard', 'arc', 'rail', 'blaster', 'jet', 'boombot', 'spider']);
      if (sup) go(sup, ai.follow.lane + rnd(-1, 1), rnd(8, 12));
      ai.follow = null;
    }
  }
  function pickLane(tm) {
    const g = G.ents.filter(e => e.kind === 'tower' && e.sub === 'guard' && e.team !== tm).sort((a, b) => a.lane - b.lane);
    if (!g[0].alive) return 0; if (!g[1].alive) return 1;
    return g[0].hp < g[1].hp ? 0 : g[1].hp < g[0].hp ? 1 : Math.random() < 0.5 ? 0 : 1;
  }

  // ---------------- headless simulation (tools/sim.js uses this to test balance) ----------------
  B.sim = (opt) => {
    G = { t: 0, time: CB.MATCH_SECS, overtime: false, over: false, opt, ents: [], proj: [], fx: [], decals: [], scorch: [], energy: [5, 5], crowns: [0, 0],
      deck: [shuffle(opt.deck.slice()), shuffle(opt.enemy.deck.slice())], lvls: [opt.levels, opt.enemy.levels], msg: [], shake: 0,
      ai: { think: 1.5, lvl: opt.enemy.skill }, ai0: { think: 1.5, lvl: opt.skill }, arena: 0, sim: true };
    for (const tm of [0, 1]) {
      const fy = y => tm ? H - y : y;
      G.ents.push(mkTower(tm, 'guard', 3.5, fy(28), 0, tm ? opt.enemy.cmd : opt.cmd));
      G.ents.push(mkTower(tm, 'guard', 14.5, fy(28), 1, tm ? opt.enemy.cmd : opt.cmd));
      G.ents.push(mkTower(tm, 'king', 9, fy(29.6), -1, tm ? opt.enemy.cmd : opt.cmd));
    }
    let res = null; opt.onEnd = r => { res = r; };
    let n = 0;
    while (!G.over && n < 60 * 300) { step(DT); G.fx.length = 0; n++; }
    const out = { crowns: G.crowns.slice(), t: G.t, played: G.played };
    G = null; return out;
  };

  // ---------------- end ----------------
  function end() {
    if (G.over) return; G.over = true;
    let a = G.crowns[0], b = G.crowns[1];
    if (a === b && G.overtime) {   // tie-break: lowest tower health loses
      const low = tm => Math.min(...G.ents.filter(e => e.kind === 'tower' && e.team === tm && e.alive).map(e => e.hp / e.maxHp), 1);
      const la = low(0), lb = low(1);
      if (Math.abs(la - lb) > 0.001) { if (la > lb) a += 0.5; else b += 0.5; }
    }
    const res = { me: G.crowns[0], them: G.crowns[1], win: a > b, draw: a === b };
    if (G.sim) return;
    B.sfx(res.win ? 'win' : 'tower');
    setTimeout(() => { const o = G && G.opt; B.running = false; if (o) o.onEnd(res); }, 2200);
  }

  // ---------------- drawing ----------------
  const cv = () => document.getElementById('arena');
  let ctx, T = 20, OX = 0, OY = 0, DPR = 1, VW = 0, VH = 0, bg = null;
  const sx = x => OX + x * T, sy = (y, z) => OY + y * T * CB.SIN - (z || 0) * T * CB.COS;
  B.toWorld = (px, py) => ({ x: (px - OX) / T, y: (py - OY) / (T * CB.SIN) });

  function layout() {
    const c = cv(); const box = c.parentElement.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    VW = box.width; VH = box.height;
    c.width = Math.round(VW * DPR); c.height = Math.round(VH * DPR); c.style.width = VW + 'px'; c.style.height = VH + 'px';
    ctx = c.getContext('2d');
    const needH = H * CB.SIN + 3.4;   // arena plus room for the back towers' sprites and health bars at the top
    T = Math.min(VW / (W + 0.6), VH / needH);
    OX = (VW - W * T) / 2; OY = (VH - H * T * CB.SIN) / 2 + T * 1.45;
  }
  B.layout = () => { if (G) { layout(); buildBg(); } };

  function buildBg() {
    const A = CB.ARENAS[G.arena]; const img = ARENA_IMG[G.arena];
    bg = document.createElement('canvas'); bg.width = Math.round(VW * DPR); bg.height = Math.round(VH * DPR);
    const g = bg.getContext('2d'); g.scale(DPR, DPR);
    g.fillStyle = '#0d1016'; g.fillRect(0, 0, VW, VH);
    if (img && img.naturalWidth) {
      const m = CB.ARENA_META; const k = T / m.ppm;
      g.drawImage(img, sx(W / 2) - m.cx * k, sy(H / 2) - m.cy * k, img.naturalWidth * k, img.naturalHeight * k);
      return;
    }
    // drawn arena: metal deck plates, a glowing energy river and two bridges
    const x0 = sx(0), x1 = sx(W), y0 = sy(0), y1 = sy(H);
    const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, shade(A.floor, -10)); gr.addColorStop(0.5, A.floor); gr.addColorStop(1, shade(A.floor, -10));
    g.fillStyle = gr; g.fillRect(x0 - T * 0.4, y0 - T * 0.3, (x1 - x0) + T * 0.8, (y1 - y0) + T * 0.6);
    for (let i = 0; i < W; i += 2) for (let j = 0; j < H; j += 2) {
      g.fillStyle = ((i + j) / 2) % 2 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.08)';
      g.fillRect(sx(i) + 1, sy(j) + 1, T * 2 - 2, T * 2 * CB.SIN - 2);
    }
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1;
    for (let i = 0; i <= W; i += 2) { g.beginPath(); g.moveTo(sx(i), y0); g.lineTo(sx(i), y1); g.stroke(); }
    for (let j = 0; j <= H; j += 2) { g.beginPath(); g.moveTo(x0, sy(j)); g.lineTo(x1, sy(j)); g.stroke(); }
    // lanes
    for (const lx of [3.5, 14.5]) { g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(sx(lx - 1), y0, T * 2, y1 - y0); }
    // edge rails
    g.fillStyle = shade(A.tint, -30); g.fillRect(x0 - T * 0.4, y0 - T * 0.3, T * 0.4, y1 - y0 + T * 0.6); g.fillRect(x1, y0 - T * 0.3, T * 0.4, y1 - y0 + T * 0.6);
    g.fillStyle = A.glow; g.globalAlpha = 0.5; g.fillRect(x0 - 2, y0, 2, y1 - y0); g.fillRect(x1, y0, 2, y1 - y0); g.globalAlpha = 1;
    // river
    const ry0 = sy(R0), ry1 = sy(R1);
    const rg = g.createLinearGradient(0, ry0, 0, ry1); rg.addColorStop(0, '#05080c'); rg.addColorStop(0.5, A.glow); rg.addColorStop(1, '#05080c');
    g.fillStyle = rg; g.globalAlpha = 0.9; g.fillRect(x0 - T * 0.4, ry0, x1 - x0 + T * 0.8, ry1 - ry0); g.globalAlpha = 1;
    // bridges
    for (const b of CB.BRIDGES) {
      const bx0 = sx(b[0] - 0.2), bx1 = sx(b[1] + 0.2);
      g.fillStyle = '#1a1e25'; g.fillRect(bx0, ry0 - T * 0.25, bx1 - bx0, ry1 - ry0 + T * 0.5);
      g.fillStyle = shade(A.tint, 10); g.fillRect(bx0 + 3, ry0 - T * 0.2, bx1 - bx0 - 6, ry1 - ry0 + T * 0.4);
      g.fillStyle = 'rgba(0,0,0,.25)'; for (let k = 0; k < 5; k++) g.fillRect(bx0 + 3, ry0 + k * (ry1 - ry0) / 5, bx1 - bx0 - 6, 1.5);
      g.fillStyle = A.glow; g.fillRect(bx0, ry0 - T * 0.25, 3, ry1 - ry0 + T * 0.5); g.fillRect(bx1 - 3, ry0 - T * 0.25, 3, ry1 - ry0 + T * 0.5);
    }
  }
  function shade(hex, p) {
    const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const f = v => clamp(Math.round(v + p * 2.55), 0, 255); return '#' + ((1 << 24) + (f(r) << 16) + (f(g) << 8) + f(b)).toString(16).slice(1);
  }

  // Cached soft glow sprites (radial gradients drawn once per colour), used for bloom-style light.
  const GLOWC = {};
  function glowImg(rgb) {
    if (GLOWC[rgb]) return GLOWC[rgb];
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, `rgba(${rgb},0.95)`); gr.addColorStop(0.5, `rgba(${rgb},0.35)`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return (GLOWC[rgb] = cv);
  }
  function glow(c, x, y, r, rgb, a) { if (r <= 0 || a <= 0) return; c.globalAlpha = Math.min(1, a); c.drawImage(glowImg(rgb), x - r, y - r, r * 2, r * 2); }

  let fxDt = 1 / 60;
  function draw() {
    const c = ctx; c.setTransform(DPR, 0, 0, DPR, 0, 0);
    let shx = 0, shy = 0; if (G.shake > 0) { shx = rnd(-1, 1) * G.shake * 7; shy = rnd(-1, 1) * G.shake * 7; }
    c.clearRect(0, 0, VW, VH);
    c.drawImage(bg, shx, shy, VW, VH);
    c.save(); c.translate(shx, shy);
    const A = CB.ARENAS[G.arena]; const argb = hexRgb(A.glow);
    // living river: drifting light streaks and a soft pulse
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.12 + 0.06 * Math.sin(G.t * 2.2); c.fillStyle = A.glow; c.fillRect(sx(0), sy(R0), W * T, (sy(R1) - sy(R0)));
    for (let i = 0; i < 9; i++) { const x = ((G.t * (0.9 + (i % 3) * 0.4) + i * 2.3) % (W + 3)) - 1.5; const yy = R0 + 0.3 + (i % 4) * 0.45; c.globalAlpha = 0.35; c.fillStyle = '#ffffff'; c.fillRect(sx(x), sy(yy) - 1, T * (0.8 + (i % 3) * 0.5), 2); }
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    // scorch marks and cracks on the floor
    for (const s of G.scorch) {
      s.t += fxDt; if (s.t < 0) continue; const k = s.t / s.dur; if (k >= 1) { s.done = true; continue; }
      const a = 0.55 * (1 - k) * Math.min(1, s.t * 8);
      const g = c.createRadialGradient(sx(s.x), sy(s.y), 0, sx(s.x), sy(s.y), s.r * T);
      g.addColorStop(0, `rgba(8,6,6,${a})`); g.addColorStop(0.6, `rgba(20,14,10,${a * 0.6})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.beginPath(); c.ellipse(sx(s.x), sy(s.y), s.r * T, s.r * T * CB.SIN, 0, 0, 7); c.fill();
      if (s.crack) { c.strokeStyle = `rgba(0,0,0,${a})`; c.lineWidth = 1.5; for (let i = 0; i < 6; i++) { const an = i * 1.05 + s.x; c.beginPath(); c.moveTo(sx(s.x), sy(s.y)); c.lineTo(sx(s.x + Math.cos(an) * s.r * 0.6), sy(s.y + Math.sin(an) * s.r * 0.6)); c.lineTo(sx(s.x + Math.cos(an + 0.3) * s.r * 1.1), sy(s.y + Math.sin(an + 0.3) * s.r * 1.1)); c.stroke(); } }
    }
    G.scorch = G.scorch.filter(s => !s.done);
    drawPlacement(c);
    // tower pads: a dark stone ring with the team's light
    for (const e of G.ents) if (e.kind === 'tower') {
      const rx = (e.r + 0.15) * T, ry = rx * CB.SIN, tc = TCOL(e.team);
      c.fillStyle = 'rgba(10,12,16,.35)'; c.beginPath(); c.ellipse(sx(e.x), sy(e.y), rx, ry, 0, 0, 7); c.fill();
      c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = T * 0.16; c.beginPath(); c.ellipse(sx(e.x), sy(e.y), rx * 0.96, ry * 0.96, 0, 0, 7); c.stroke();
      c.strokeStyle = tc[0]; c.globalAlpha = e.alive ? 0.75 : 0.25; c.lineWidth = Math.max(1.5, T * 0.07); c.beginPath(); c.ellipse(sx(e.x), sy(e.y), rx * 0.96, ry * 0.96, 0, 0, 7); c.stroke(); c.globalAlpha = 1;
    }
    for (const d of G.decals) B.drawSprite(c, d.sub === 'king' ? 'kingx' : 'guardx', TEAM[d.team], 'i0', 0, sx(d.x), sy(d.y), T * 0.85);
    // shadows + team rings under every robot
    for (const e of G.ents) if (e.alive && e.kind !== 'tower') {
      const rx = e.r * T * 1.35, ry = rx * CB.SIN * 0.75;
      c.fillStyle = 'rgba(0,0,0,.38)'; c.beginPath(); c.ellipse(sx(e.x), sy(e.y), rx, ry, 0, 0, 7); c.fill();
      const tc = TCOL(e.team); c.strokeStyle = tc[0]; c.globalAlpha = 0.75; c.lineWidth = Math.max(1.5, T * 0.09);
      c.beginPath(); c.ellipse(sx(e.x), sy(e.y), rx * 0.95, ry * 0.95, 0, 0, 7); c.stroke(); c.globalAlpha = 1;
    }
    for (const s of G.spells || []) drawSpell(c, s);
    const list = G.ents.filter(e => e.alive).sort((a, b) => (a.air - b.air) || (a.y - b.y));
    for (const e of list) drawEnt(c, e);
    for (const p of G.proj) drawProj(c, p);
    drawFx(c);
    // floating motes of light over the arena
    c.save(); c.globalCompositeOperation = 'lighter';
    for (const m of G.motes) { m.p += fxDt; m.z += fxDt * 0.15; if (m.z > 3.5) { m.z = 0.2; m.x = rnd(0, W); m.y = rnd(0, H); } glow(c, sx(m.x + Math.sin(m.p * 0.7) * 0.4), sy(m.y, m.z), T * 0.16, argb, 0.35 * Math.sin(Math.min(Math.PI, m.z / 3.5 * Math.PI))); }
    c.restore();
    for (const e of list) drawBar(c, e);
    drawGhost(c);
    c.restore();
    drawMsgs(c);
  }
  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return `${n >> 16},${(n >> 8) & 255},${n & 255}`; }

  function drawEnt(c, e) {
    let kx = 0, ky = 0;
    if (e.kickT > 0) { e.kickT -= fxDt; const k = Math.sin(Math.max(0, e.kickT) / 0.14 * Math.PI) * e.kickD; kx = Math.cos(e.kickA) * k; ky = Math.sin(e.kickA) * k; }   // flinch away from a hit
    const x = sx(e.x + kx), y = sy(e.y + ky, e.air ? 1.6 + Math.sin(G.t * 3 + e.id) * 0.08 : 0);
    if (e.kind === 'tower') {
      const lab = e.fireT < 0.13 ? ((e.shotN || 0) % 2 ? 'a1' : 'a0') : 'i0';
      const team = TEAM[e.team];
      if (!B.drawSprite(c, e.sub, team, lab, e.face, x, y, T * 0.85)) fallback(c, e, x, y);
      if (e.sub === 'king' && !e.active) { c.fillStyle = 'rgba(255,255,255,.8)'; c.font = `bold ${T * 0.6}px system-ui`; c.textAlign = 'center'; c.fillText('z', x + T * 1.4, y - T * 2.4 - Math.sin(G.t * 2) * 3); }
      if (e.flash > 0) { c.save(); c.globalCompositeOperation = 'lighter'; B.drawSprite(c, e.sub, team, lab, e.face, x, y, T * 0.85, Math.min(0.35, e.flash * 3)); c.restore(); }
      return;
    }
    const sp = e.c.sprite; const team = TEAM[e.team];
    const af = Math.floor(e.atkT / FD);
    let lab = 'i' + (Math.floor(G.t * 3.2 + e.id * 0.37) % 4);
    if ((e.c.beam || e.c.cone) && e.anim === 'attack' && e.locked) lab = 'a' + (1 + Math.floor(G.t * 11) % 5);
    else if (e.c.spawn) lab = af < 6 ? 'a' + af : 'i' + (Math.floor(G.t * 3.2) % 4);
    else if (e.kind === 'building') lab = af < 6 ? 'a' + af : 'i0';
    else if (af < 6 && (e.pend || e.anim === 'attack')) lab = 'a' + af;
    else if (e.air) lab = 'w' + (Math.floor(e.walkPh * 8 + G.t * 7) % 8);
    else if (e.anim === 'walk') lab = 'w' + (Math.floor(e.walkPh * 8) % 8);
    if (e.air && e.anim !== 'walk') e.walkPh += 0.01;
    const alpha = e.deploy > 0 ? 1 - e.deploy * 0.7 : 1;
    if (!B.drawSprite(c, sp, team, lab, e.face, x, y, T * US * (SPS[sp] || 1), alpha)) fallback(c, e, x, y);
    if (e.flash > 0) { c.save(); c.globalCompositeOperation = 'lighter'; B.drawSprite(c, sp, team, lab, e.face, x, y, T * US * (SPS[sp] || 1), Math.min(0.6, e.flash * 5)); c.restore(); }   // hit flash: the robot itself brightens
    if (e.slowT > 0) { c.save(); c.globalCompositeOperation = 'lighter'; glow(c, x, y - T * e.r * US, T * e.r * US * 1.6, '150,230,255', 0.35); c.restore();
      if (Math.random() < 0.15) G.fx.push({ type: 'spark', x: e.x + rnd(-0.4, 0.4), y: e.y + rnd(-0.3, 0.3), z: rnd(0.3, 1.4), vx: 0, vy: 0, vz: -0.4, t: 0, dur: 0.5, col: '#e8fbff', size: 0.05 }); }
    if (e.stun > 0) { c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = '#aef'; c.lineWidth = 2;
      for (let k = 0; k < 4; k++) { let px = x + rnd(-0.5, 0.5) * T, py = y - rnd(0.3, 1.3) * T * US; c.beginPath(); c.moveTo(px, py); for (let j = 0; j < 3; j++) { px += rnd(-8, 8); py += rnd(-8, 8); c.lineTo(px, py); } c.stroke(); } c.restore(); }
    if (e.charging) { c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = 'rgba(255,240,120,.8)'; c.lineWidth = 2; const bx_ = -Math.cos(e.face), by_ = -Math.sin(e.face);
      for (let k = 0; k < 5; k++) { const off = rnd(-0.5, 0.5); const yy = rnd(0.3, 1.0); c.beginPath(); c.moveTo(sx(e.x + bx_ * 0.6 + by_ * off), sy(e.y + by_ * 0.6 - bx_ * off, yy)); c.lineTo(sx(e.x + bx_ * rnd(1.4, 2.4) + by_ * off), sy(e.y + by_ * rnd(1.4, 2.4) - bx_ * off, yy)); c.stroke(); }
      glow(c, x, y - T * 0.6, T * 1.1, '255,240,120', 0.35); c.restore(); }
    if (e.c.beam && e.anim === 'attack' && e.beamTarget && e.beamTarget.alive && e.locked) drawBeam(c, e, e.beamTarget);
  }
  function fallback(c, e, x, y) {   // used only if a sprite sheet failed to load
    c.fillStyle = e.team ? '#d6452c' : '#2f6ae8'; c.beginPath(); c.arc(x, y - e.r * T, e.r * T, 0, 7); c.fill();
    c.fillStyle = '#fff'; c.font = `bold ${T * 0.5}px system-ui`; c.textAlign = 'center'; c.fillText(e.kind === 'tower' ? 'T' : e.c.name[0], x, y - e.r * T + T * 0.18);
  }
  // Colossus beam: wavy, layered, thicker and hotter the longer it holds one target.
  function drawBeam(c, u, e) {
    const st = u.c.ramp ? (u.beamT < 2 ? 0 : u.beamT < 4 ? 1 : 2) : 1;
    const tc = u.c.frost ? ['#7fe6ff', '#e8fbff', '127,230,255'] : TCOL(u.team); const hot = u.c.frost ? '230,250,255' : ['255,255,255', '255,240,190', '255,250,230'][st];
    const reach = u.c.frost ? 1.2 : 1.6, oz = u.c.frost ? 1.3 : 2.0;
    const ox = u.x + Math.cos(u.face) * reach, oy = u.y + Math.sin(u.face) * reach;
    const x0 = sx(ox), y0 = sy(oy, oz), x1 = sx(e.x), y1 = sy(e.y, e.air ? 1.8 : e.kind === 'tower' ? 1.5 : 0.7);
    const w = [4, 7, 12][st] * T / 24; const L = Math.hypot(x1 - x0, y1 - y0); const nx = -(y1 - y0) / L, ny = (x1 - x0) / L;
    c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
    const path = (amp, ph) => { c.beginPath(); for (let i = 0; i <= 14; i++) { const k = i / 14, wv = Math.sin(k * 9 + G.t * 30 + ph) * amp * Math.sin(k * Math.PI); c.lineTo(x0 + (x1 - x0) * k + nx * wv, y0 + (y1 - y0) * k + ny * wv); } c.stroke(); };
    c.strokeStyle = tc[0]; c.globalAlpha = 0.35; c.lineWidth = w * 3.2; path(w * 0.5, 0);
    c.globalAlpha = 0.8; c.lineWidth = w * 1.4; path(w * 0.8, 1.3);
    c.strokeStyle = `rgb(${hot})`; c.globalAlpha = 1; c.lineWidth = w * 0.45; path(w * 0.3, 2.1);
    glow(c, x0, y0, w * 4, tc[2], 0.9); glow(c, x1, y1, w * (5 + st * 2), hot, 0.9); glow(c, x1, y1, w * 9, tc[2], 0.5);
    c.restore();
    if (Math.random() < 0.5 + st * 0.2) G.fx.push({ type: 'spark', x: e.x, y: e.y, z: e.air ? 1.8 : 0.8, vx: rnd(-3, 3), vy: rnd(-3, 3), vz: rnd(1, 4), t: 0, dur: 0.3, col: st === 2 ? '#fff6c0' : tc[1], size: 0.06 + st * 0.02 });
  }
  function drawBar(c, e) {
    if (e.kind === 'tower') {
      if (!e.alive) return;
      const w = T * (e.sub === 'king' ? 3 : 2.4), x = sx(e.x) - w / 2, y = sy(e.y) - T * (e.sub === 'king' ? 4.4 : 3.5);
      c.fillStyle = 'rgba(0,0,0,.6)'; rr(c, x - 2, y - 2, w + 4, T * 0.42 + 4, 4); c.fill();
      c.fillStyle = e.team ? '#e5483a' : '#3aa0ff'; rr(c, x, y, w * Math.max(0, e.hp / e.maxHp), T * 0.42, 3); c.fill();
      c.fillStyle = '#fff'; c.font = `bold ${Math.max(9, T * 0.36)}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(Math.ceil(e.hp), x + w / 2, y + T * 0.22); c.textBaseline = 'alphabetic';
      return;
    }
    if (e.hp >= e.maxHp && e.kind !== 'building') return;
    const h = e.air ? 1.6 : 0; const ht = { titan: 3.6, colossus: 4.6, rocket: 2.6, sentinel: 2.3, blaster: 2.0, spider: 0.8, turret: 1.8, jet: 1.0, medic: 1.6, hound: 1.6, rail: 2.6, arc: 2.3, scorcher: 1.5, bombard: 1.7, bomber: 1.3, hive: 1.9, minidrone: 0.5, boombot: 0.9, cryo: 2.6 }[e.card] || 2;
    const w = Math.max(T * 0.8, e.r * T * 1.8), x = sx(e.x) - w / 2, y = sy(e.y, h + ht * 0.82 * US * 1.08);
    c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(x - 1, y - 1, w + 2, 5);
    c.fillStyle = e.team ? '#ff5a45' : '#45b4ff'; c.fillRect(x, y, w * Math.max(0, e.hp / e.maxHp), 3);
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  function drawProj(c, p) {
    const tc = TCOL(p.team);
    const X = sx(p.x), Y = sy(p.y, p.z);
    p.trail.push([p.x, p.y, p.z]); if (p.trail.length > 7) p.trail.shift();
    const t0 = p.trail[0];
    c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
    if (p.kind === 'laser') {
      c.strokeStyle = tc[0]; c.globalAlpha = 0.45; c.lineWidth = T * 0.32; c.beginPath(); c.moveTo(sx(t0[0]), sy(t0[1], t0[2])); c.lineTo(X, Y); c.stroke();
      c.strokeStyle = tc[1]; c.globalAlpha = 1; c.lineWidth = T * 0.1; c.stroke();
      glow(c, X, Y, T * 0.55, tc[2], 0.9);
    } else if (p.kind === 'mortar' || p.kind === 'bomb') {
      glow(c, X, Y, T * 0.55, '255,170,70', 0.9); c.globalCompositeOperation = 'source-over'; c.fillStyle = '#2a2a2e';
      c.beginPath(); c.arc(X, Y, T * (p.kind === 'bomb' ? 0.2 : 0.16), 0, 7); c.fill();
      c.globalCompositeOperation = 'lighter'; glow(c, X, Y - T * 0.05, T * 0.12, '255,240,200', 1);
    } else if (p.kind === 'minimissile') {
      const dx = X - sx(t0[0]), dy = Y - sy(t0[1], t0[2]); const L = Math.hypot(dx, dy) || 1; const ux = dx / L, uy = dy / L;
      c.globalCompositeOperation = 'source-over'; c.strokeStyle = '#eef'; c.lineWidth = T * 0.08; c.beginPath(); c.moveTo(X - ux * T * 0.25, Y - uy * T * 0.25); c.lineTo(X, Y); c.stroke();
      c.globalCompositeOperation = 'lighter'; glow(c, X - ux * T * 0.3, Y - uy * T * 0.3, T * 0.3, '255,170,60', 1);
      if (Math.random() < 0.7) G.fx.push({ type: 'smoke', x: p.x, y: p.y, z: p.z, t: 0, dur: 0.45, size: 0.1, vz: 0.2, light: true });
    } else if (p.kind === 'shell' || p.kind === 'tower') {
      const big = p.kind === 'tower';
      for (let i = 0; i < p.trail.length; i++) { const t = p.trail[i]; glow(c, sx(t[0]), sy(t[1], t[2]), T * (big ? 0.35 : 0.25) * (i + 1) / p.trail.length, big ? tc[2] : '255,170,70', 0.35); }
      glow(c, X, Y, T * (big ? 0.7 : 0.5), big ? tc[2] : '255,170,70', 1); glow(c, X, Y, T * (big ? 0.28 : 0.2), '255,255,255', 1);
    } else {   // rocket: body, flame and glow (smoke comes from the effects list)
      const dx = X - sx(t0[0]), dy = Y - sy(t0[1], t0[2]); const L = Math.hypot(dx, dy) || 1; const ux = dx / L, uy = dy / L;
      c.globalCompositeOperation = 'source-over'; c.strokeStyle = '#e8e2d4'; c.lineWidth = T * 0.13; c.beginPath(); c.moveTo(X - ux * T * 0.35, Y - uy * T * 0.35); c.lineTo(X, Y); c.stroke();
      c.globalCompositeOperation = 'lighter';
      glow(c, X - ux * T * 0.45, Y - uy * T * 0.45, T * (0.45 + Math.random() * 0.15), '255,170,60', 1); glow(c, X - ux * T * 0.4, Y - uy * T * 0.4, T * 0.18, '255,255,220', 1);
    }
    c.restore();
  }

  function drawSpell(c, s) {
    const C = CB.CARDS[s.card];
    c.save();
    c.strokeStyle = s.team ? 'rgba(255,140,60,.7)' : 'rgba(80,220,255,.7)'; c.lineWidth = 2; c.setLineDash([6, 5]); c.lineDashOffset = -G.t * 20;
    c.beginPath(); c.ellipse(sx(s.x), sy(s.y), C.radius * T, C.radius * T * CB.SIN, 0, 0, 7); c.stroke(); c.setLineDash([]);
    if (s.card === 'missile') {
      const zf = kk => 3 + Math.sin(kk * Math.PI) * 6 * (1 - kk * 0.3) - kk * 3;
      const k = s.t / s.dur; const x = s.sx + (s.x - s.sx) * k, y = s.sy + (s.y - s.sy) * k, z = zf(k);
      if (Math.random() < 0.9) G.fx.push({ type: 'smoke', x, y, z, t: 0, dur: rnd(0.6, 1.1), size: rnd(0.3, 0.5), vz: 0.2, light: true });
      c.globalCompositeOperation = 'lighter';
      glow(c, sx(x), sy(y, z), T * 1.1, '255,170,60', 1); glow(c, sx(x), sy(y, z), T * 0.4, '255,255,230', 1);
      c.globalAlpha = 0.25 + k * 0.4; c.fillStyle = '#ff5a2a'; c.beginPath(); c.ellipse(sx(s.x), sy(s.y), C.radius * T * (1 - k * 0.6), C.radius * T * CB.SIN * (1 - k * 0.6), 0, 0, 7); c.fill();
    }
    c.restore();
  }

  function drawFx(c) {
    const dt = fxDt;
    c.save();
    for (const f of G.fx) {
      f.t += dt; if (f.t < 0) continue; const k = f.t / f.dur; if (k >= 1) { f.done = true; continue; }
      if (f.type === 'ring') {
        c.globalCompositeOperation = 'lighter'; c.strokeStyle = f.col; c.globalAlpha = (1 - k) * 0.9; c.lineWidth = T * 0.22 * (1 - k) + 1;
        const e = 1 - Math.pow(1 - k, 2.5);
        c.beginPath(); c.ellipse(sx(f.x), sy(f.y), f.R * e * T, f.R * e * T * CB.SIN, 0, 0, 7); c.stroke();
      } else if (f.type === 'flash') {
        c.globalCompositeOperation = 'lighter'; glow(c, sx(f.x), sy(f.y, f.z || 0.6), f.r * T * 1.6 * (0.6 + k * 0.6), '255,240,200', 1 - k);
      } else if (f.type === 'glow') {
        c.globalCompositeOperation = 'lighter'; glow(c, sx(f.x), sy(f.y, f.z), f.r * T * (1 + k * 0.4), f.col, (1 - k) * 1.2); glow(c, sx(f.x), sy(f.y, f.z), f.r * T * 0.4, '255,255,255', 1 - k);
      } else if (f.type === 'fireball') {
        // several puffs that flash white, burn yellow-orange, then darken and rise
        const rs = f.r * T; const cx = sx(f.x), cy = sy(f.y, f.z + k * f.r * 0.6);
        c.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 7; i++) {
          const a = f.seed + i * 2.4, d = (i === 0 ? 0 : 0.45) * rs * (0.4 + k * 0.8);
          const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d * 0.7 - k * rs * 0.3 * (i % 3);
          const rad = rs * (0.55 + 0.45 * Math.sin(Math.min(1, k * 2.2) * Math.PI * 0.5)) * (i === 0 ? 1.1 : 0.75) * (1 - k * 0.25);
          const heat = 1 - k;
          glow(c, px, py, rad * 1.3, heat > 0.6 ? '255,230,160' : heat > 0.3 ? '255,150,50' : '200,70,20', heat * 0.95);
          if (k < 0.35) glow(c, px, py, rad * 0.55, '255,255,240', (0.35 - k) * 2.5);
        }
      } else if (f.type === 'spark') {
        f.x += f.vx * dt; f.y += f.vy * dt; f.z = Math.max(0, f.z + f.vz * dt); f.vz -= 12 * dt; f.vx *= 0.97; f.vy *= 0.97;
        c.globalCompositeOperation = 'lighter'; c.globalAlpha = 1 - k; c.strokeStyle = f.col; c.lineWidth = Math.max(1, f.size * T * 0.8); c.lineCap = 'round';
        const X = sx(f.x), Y = sy(f.y, f.z); c.beginPath(); c.moveTo(X, Y); c.lineTo(X - f.vx * dt * T * 1.6, Y - (f.vy * CB.SIN - f.vz * CB.COS) * dt * T * 1.6); c.stroke();
      } else if (f.type === 'smoke') {
        f.z += (f.vz || 0.8) * dt;
        c.globalCompositeOperation = 'source-over'; c.globalAlpha = (f.light ? 0.35 : 0.5) * (1 - k) * Math.min(1, f.t * 10);
        c.fillStyle = f.light ? '#9aa0a8' : '#2c2a2c';
        c.beginPath(); c.arc(sx(f.x), sy(f.y, f.z), f.size * T * (0.6 + k * 1.1), 0, 7); c.fill();
      } else if (f.type === 'dust') {
        f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.92; f.vy *= 0.92; f.z += 0.4 * dt;
        c.globalCompositeOperation = 'source-over'; c.globalAlpha = 0.45 * (1 - k); c.fillStyle = '#6a6258';
        c.beginPath(); c.arc(sx(f.x), sy(f.y, f.z), f.size * T * (0.5 + k), 0, 7); c.fill();
      } else if (f.type === 'debris') {
        f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt; f.vz -= 16 * dt; f.rot += f.vr * dt;
        if (f.z < 0) { f.z = 0; f.vz = -f.vz * 0.35; f.vx *= 0.6; f.vy *= 0.6; f.vr *= 0.5; }
        c.globalCompositeOperation = 'source-over'; c.globalAlpha = Math.min(1, (1 - k) * 3); c.fillStyle = f.col;
        c.save(); c.translate(sx(f.x), sy(f.y, f.z)); c.rotate(f.rot); c.fillRect(-f.w * T / 2, -f.h * T / 2, f.w * T, f.h * T); c.restore();
        if (k < 0.4) { c.globalCompositeOperation = 'lighter'; glow(c, sx(f.x), sy(f.y, f.z), f.w * T * 1.2, '255,140,40', (0.4 - k) * 2); }
      } else if (f.type === 'slash') {
        // a bright crescent sweeping across the swing
        const sweep = Math.min(1, k * 2.2); const a0 = f.a - 1.4, a1 = a0 + 2.8 * sweep;
        c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
        for (const [w, al, col] of [[T * 0.55, 0.3, f.col[0]], [T * 0.26, 0.85, f.col[0]], [T * 0.09, 1, '#ffffff']]) {
          c.strokeStyle = col; c.globalAlpha = al * (1 - k); c.lineWidth = w; c.beginPath();
          for (let i = 0; i <= 12; i++) { const an = a0 + (a1 - a0) * i / 12; const rr_ = f.r * (0.85 + 0.15 * Math.sin(i / 12 * Math.PI)); c.lineTo(sx(f.x + Math.cos(an) * rr_), sy(f.y + Math.sin(an) * rr_, 0.9 + 0.5 * Math.sin(i / 12 * Math.PI))); }
          c.stroke();
        }
      } else if (f.type === 'zap') {
        c.globalCompositeOperation = 'lighter'; c.strokeStyle = f.col; c.lineCap = 'round';
        for (const [w, al] of [[f.thin ? 3 : 6, 0.35], [f.thin ? 1.2 : 2.2, 1]]) {
          c.globalAlpha = al * (1 - k); c.lineWidth = w; c.beginPath();
          for (let i = 0; i <= 6; i++) { const kk = i / 6; c.lineTo(sx(f.x1 + (f.x2 - f.x1) * kk) + (i % 6 ? rnd(-6, 6) : 0), sy(f.y1 + (f.y2 - f.y1) * kk, f.z) + (i % 6 ? rnd(-6, 6) : 0)); }
          c.stroke();
        }
        glow(c, sx(f.x2), sy(f.y2, f.z), T * 0.6, '255,250,200', 1 - k);
      } else if (f.type === 'rail') {   // piercing railgun line: white core, team glow, fading
        const a = 1 - k, X1 = sx(f.x1), Y1 = sy(f.y1, f.z), X2 = sx(f.x2), Y2 = sy(f.y2, f.z * 0.6);
        c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
        for (const [w, al, col] of [[T * 0.9 * (1 - k * 0.5), 0.3, f.col[0]], [T * 0.38, 0.8, f.col[0]], [T * 0.12, 1, '#ffffff']]) { c.strokeStyle = col; c.globalAlpha = al * a; c.lineWidth = w; c.beginPath(); c.moveTo(X1, Y1); c.lineTo(X2, Y2); c.stroke(); }
        for (let i = 0; i < 5; i++) { const q = (i + 0.5) / 5; glow(c, X1 + (X2 - X1) * q, Y1 + (Y2 - Y1) * q, T * 0.5 * (1 - k), f.col[2], a * 0.7); }
      } else if (f.type === 'chain') {   // chain lightning between hits
        c.globalCompositeOperation = 'lighter'; c.lineCap = 'round'; c.lineJoin = 'round';
        for (const [w, al, col] of [[7, 0.35, f.col[0]], [3, 0.9, f.col[0]], [1.4, 1, '#ffffff']]) {
          c.strokeStyle = col; c.globalAlpha = al * (1 - k); c.lineWidth = w; c.beginPath();
          for (let i = 0; i < f.pts.length - 1; i++) { const A = f.pts[i], Bp = f.pts[i + 1]; for (let j = 0; j <= 6; j++) { const q = j / 6; const jit = (j % 6) ? 1 : 0; c.lineTo(sx(A[0] + (Bp[0] - A[0]) * q) + rnd(-7, 7) * jit, sy(A[1] + (Bp[1] - A[1]) * q, A[2] + (Bp[2] - A[2]) * q) + rnd(-7, 7) * jit); } }
          c.stroke();
        }
        for (const q of f.pts) glow(c, sx(q[0]), sy(q[1], q[2]), T * 0.55, f.col[2], 1 - k);
      } else if (f.type === 'flamep') {   // flamethrower particle: yellow, orange, then smoky red
        f.x += f.vx * dt; f.y += f.vy * dt; f.z += 0.6 * dt; f.vx *= 0.97; f.vy *= 0.97;
        c.globalCompositeOperation = 'lighter';
        glow(c, sx(f.x), sy(f.y, f.z), T * f.size * (0.7 + k * 1.6), k < 0.35 ? '255,230,140' : k < 0.7 ? '255,140,40' : '200,60,20', (1 - k) * 0.9);
      } else if (f.type === 'target') {   // where a shell or bomb will land
        c.globalCompositeOperation = 'source-over'; c.strokeStyle = f.col; c.globalAlpha = 0.35 + 0.35 * Math.sin(k * 20); c.lineWidth = 2; c.setLineDash([5, 4]);
        c.beginPath(); c.ellipse(sx(f.x), sy(f.y), f.R * T, f.R * T * CB.SIN, 0, 0, 7); c.stroke(); c.setLineDash([]);
      } else if (f.type === 'muzzle') {
        c.globalCompositeOperation = 'lighter'; glow(c, sx(f.x), sy(f.y, f.z), T * 0.5, '255,220,150', 1 - k);
      } else if (f.type === 'emp') {
        c.globalCompositeOperation = 'lighter';
        for (let r = 0; r < 3; r++) { const kk = clamp(k * 1.3 - r * 0.15, 0, 1); c.globalAlpha = (1 - kk) * 0.9; c.strokeStyle = '#8ff6ff'; c.lineWidth = 3;
          c.beginPath(); c.ellipse(sx(f.x), sy(f.y), f.R * kk * T, f.R * kk * T * CB.SIN, 0, 0, 7); c.stroke(); }
        c.globalAlpha = (1 - k) * 0.25; c.fillStyle = '#8ff6ff'; c.beginPath(); c.ellipse(sx(f.x), sy(f.y), f.R * T, f.R * T * CB.SIN, 0, 0, 7); c.fill();
        glow(c, sx(f.x), sy(f.y, 0.5), f.R * T * 0.8, '140,246,255', (1 - k) * 0.8);
        c.globalAlpha = 1 - k; c.strokeStyle = '#e8ffff'; c.lineWidth = 1.5;
        for (let i = 0; i < 7; i++) { let a = rnd(0, 6.28), x = sx(f.x), y = sy(f.y, 0.3); c.beginPath(); c.moveTo(x, y); for (let j = 1; j < 5; j++) { x += Math.cos(a) * f.R * T / 5 + rnd(-5, 5); y += Math.sin(a) * f.R * T * CB.SIN / 5 + rnd(-5, 5); c.lineTo(x, y); } c.stroke(); }
      } else if (f.type === 'beamdown') {
        c.globalCompositeOperation = 'lighter'; const al = (1 - k) * 0.8;
        const top = sy(f.y, 9), bot = sy(f.y); const wdt = f.r * T * (1 - k * 0.6);
        const g = c.createLinearGradient(0, top, 0, bot); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, f.col);
        c.globalAlpha = al; c.fillStyle = g; c.fillRect(sx(f.x) - wdt, top, wdt * 2, bot - top);
        c.fillStyle = '#ffffff'; c.globalAlpha = al * 0.8; c.fillRect(sx(f.x) - wdt * 0.25, top, wdt * 0.5, bot - top);
        glow(c, sx(f.x), sy(f.y), wdt * 2.2, hexRgb(f.col), al);
      }
    }
    c.restore();
    G.fx = G.fx.filter(f => !f.done);
    if (G.fx.length > 700) G.fx.splice(0, G.fx.length - 700);
  }

  function drawPlacement(c) {
    const card = G.drag ? G.drag.card : G.sel; if (!card || CB.CARDS[card].type === 'spell') return;
    c.save(); c.fillStyle = 'rgba(255,40,40,.16)';
    // red over everything you cannot use
    for (let y = 0; y < H; y += 0.5) for (const half of [0, 1]) {
      const x = half ? W / 2 + 0.25 : 0.25;
      if (!validSpot(0, card, x + 4, y + 0.25)) c.fillRect(sx(half ? W / 2 : 0), sy(y), W / 2 * T, T * 0.5 * CB.SIN + 0.5);
    }
    c.restore();
  }
  function drawGhost(c) {
    const h = G.hover; const card = G.drag ? G.drag.card : G.sel; if (!h || !card) return;
    const C = CB.CARDS[card]; const ok = validSpot(0, card, h.x, h.y);
    if (C.type === 'spell') {
      c.save(); c.fillStyle = ok ? 'rgba(120,230,255,.18)' : 'rgba(255,60,60,.2)'; c.strokeStyle = ok ? '#bff6ff' : '#f66'; c.lineWidth = 2;
      c.beginPath(); c.ellipse(sx(h.x), sy(h.y), C.radius * T, C.radius * T * CB.SIN, 0, 0, 7); c.fill(); c.stroke(); c.restore(); return;
    }
    c.save(); c.globalAlpha = ok ? 0.65 : 0.35;
    const n = C.count;
    for (let k = 0; k < n; k++) {
      let ox = 0, oy = 0; if (n > 1) { const a = k / n * Math.PI * 2 + 0.4; const rr = n > 3 ? 0.75 : 0.5; ox = Math.cos(a) * rr; oy = Math.sin(a) * rr; }
      if (!B.drawSprite(c, C.sprite, 'blue', C.air ? 'w0' : 'i0', -Math.PI / 2, sx(h.x + ox), sy(h.y + oy, C.air ? 1.6 : 0), T * US, ok ? 0.65 : 0.35)) { c.fillStyle = '#4af'; c.beginPath(); c.arc(sx(h.x + ox), sy(h.y + oy), T * 0.4, 0, 7); c.fill(); }
    }
    c.globalAlpha = 1; c.strokeStyle = ok ? 'rgba(255,255,255,.7)' : 'rgba(255,80,80,.8)'; c.lineWidth = 1.5;
    c.beginPath(); c.ellipse(sx(h.x), sy(h.y), (C.radius + 0.5) * T, (C.radius + 0.5) * T * CB.SIN, 0, 0, 7); c.stroke();
    if (C.range > 2 && C.type !== 'spell') { c.setLineDash([4, 6]); c.strokeStyle = 'rgba(255,255,255,.3)'; c.beginPath(); c.ellipse(sx(h.x), sy(h.y), (C.range + C.radius) * T, (C.range + C.radius) * T * CB.SIN, 0, 0, 7); c.stroke(); c.setLineDash([]); }
    c.restore();
  }
  function drawMsgs(c) {
    G.msg = G.msg.filter(m => (m.t -= 1 / 60) > 0);
    G.msg.forEach((m, i) => {
      const k = m.t / m.dur; const a = Math.min(1, k * 4, (1 - k) * 8);
      c.save(); c.globalAlpha = a; c.font = `900 ${Math.round(T * 1.3)}px system-ui`; c.textAlign = 'center';
      c.lineWidth = 6; c.strokeStyle = 'rgba(0,0,0,.7)'; c.strokeText(m.text, VW / 2, VH * 0.42 + i * T * 1.6);
      c.fillStyle = m.col; c.fillText(m.text, VW / 2, VH * 0.42 + i * T * 1.6); c.restore();
    });
  }

  // ---------------- HUD + hand ----------------
  const $ = id => document.getElementById(id);
  function renderHand() {
    const hand = G.deck[0].slice(0, 4), next = G.deck[0][4];
    const el = $('hand'); el.innerHTML = '';
    hand.forEach(id => { const d = CB.UI.cardEl(id, G.lvls[0][id], { small: true }); d.dataset.card = id; if (G.sel === id) d.classList.add('sel'); el.appendChild(d); });
    const nx = $('nextCard'); nx.innerHTML = ''; if (next) nx.appendChild(CB.UI.cardEl(next, G.lvls[0][next], { tiny: true }));
  }
  function hud() {
    const e = G.energy[0];
    $('eFill').style.width = (e / 10 * 100) + '%'; $('eNum').textContent = Math.floor(e);
    const t = Math.max(0, Math.ceil(G.time)); $('bTimer').textContent = (G.overtime ? 'OT ' : '') + Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
    $('bTimer').classList.toggle('dbl', G.overtime || G.time <= CB.DOUBLE_AT);
    $('crMe').textContent = G.crowns[0]; $('crThem').textContent = G.crowns[1];
    document.querySelectorAll('#hand .card').forEach(d => d.classList.toggle('poor', CB.CARDS[d.dataset.card].cost > e));
  }

  // ---------------- input ----------------
  B.bindInput = () => {
    const stage = $('battle');
    stage.addEventListener('pointerdown', ev => {
      if (!G || G.over) return;
      const card = ev.target.closest('#hand .card');
      if (card) {
        const id = card.dataset.card;
        G.drag = { card: id, el: card, sx: ev.clientX, sy: ev.clientY, moved: false };
        stage.setPointerCapture && stage.setPointerCapture(ev.pointerId);
        return;
      }
      const cvb = cv().getBoundingClientRect();
      if (G.sel && ev.clientY < cvb.bottom) { const w = B.toWorld(ev.clientX - cvb.left, ev.clientY - cvb.top); tryPlay(G.sel, w.x, w.y); }
    });
    stage.addEventListener('pointermove', ev => {
      if (!G) return;
      const cvb = cv().getBoundingClientRect();
      if (G.drag) {
        if (Math.hypot(ev.clientX - G.drag.sx, ev.clientY - G.drag.sy) > 12) G.drag.moved = true;
        if (G.drag.moved && ev.clientY < cvb.bottom) { const w = B.toWorld(ev.clientX - cvb.left, ev.clientY - cvb.top - T * 0.6); G.hover = { x: clamp(w.x, 0, W), y: clamp(w.y, 0, H) }; }
        else G.hover = null;
      } else if (G.sel && ev.pointerType === 'mouse') { const w = B.toWorld(ev.clientX - cvb.left, ev.clientY - cvb.top); G.hover = ev.clientY < cvb.bottom ? w : null; }
    });
    const up = ev => {
      if (!G || !G.drag) return;
      const d = G.drag; G.drag = null;
      if (!d.moved) { G.sel = G.sel === d.card ? null : d.card; G.hover = null; renderHand(); B.sfx('tick'); return; }
      if (G.hover) tryPlay(d.card, G.hover.x, G.hover.y);
      G.hover = null;
    };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', () => { if (G) { G.drag = null; G.hover = null; } });
    window.addEventListener('resize', () => setTimeout(B.layout, 50));
    if (window.ResizeObserver) { let lastH = 0; new ResizeObserver(en => { const h = en[0].contentRect.height; if (Math.abs(h - lastH) > 2) { lastH = h; B.layout(); } }).observe($('field')); }
  };
  function tryPlay(card, x, y) {
    const C = CB.CARDS[card];
    if (G.energy[0] < C.cost) { B.sfx('no'); flashEnergy(); return; }
    if (!validSpot(0, card, x, y)) { B.sfx('no'); return; }
    if (play(0, card, x, y)) { G.sel = null; G.hover = null; renderHand(); }
  }
  function flashEnergy() { const e = $('eBar'); e.classList.remove('shake'); void e.offsetWidth; e.classList.add('shake'); }

  // ---------------- loop ----------------
  let last = 0, acc = 0;
  function frame(ts) {
    if (!B.running || !G) return;
    const el = Math.min(0.1, (ts - last) / 1000); last = ts; acc += el;
    if (G.hitstop > 0) { G.hitstop -= el; acc = 0; }   // brief freeze on heavy hits
    while (acc >= DT) { if (!G.over) step(DT); acc -= DT; if (!G) return; }
    G.shake = Math.max(0, G.shake - el);
    fxDt = el; draw(); hud();
    requestAnimationFrame(frame);
  }
  B.G = () => G;
})();
