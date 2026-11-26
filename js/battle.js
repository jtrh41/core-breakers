// Core Breakers: the battle. Simulation (units, towers, projectiles, spells), the computer opponent, drawing and touch input.
'use strict';
(function () {
  const B = CB.B = {};
  const W = CB.W, H = CB.H, R0 = CB.RIVER[0], R1 = CB.RIVER[1], MIDY = (R0 + R1) / 2;
  const TEAM = ['blue', 'red'];
  const DT = 1 / 30;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // ---------------- sprites ----------------
  const SPR = {};
  B.loadSprites = (onProgress) => new Promise(res => {
    const sheets = CB.SHEETS || {}; const names = [];
    for (const n in sheets) for (const t of TEAM) names.push([n, t]);
    let left = names.length; if (!left) return res();
    names.forEach(([n, t]) => {
      const img = new Image(); img.decoding = 'async';
      img.onload = img.onerror = () => { if (img.naturalWidth) SPR[n + '_' + t] = { img, m: sheets[n] }; left--; onProgress && onProgress(1 - left / names.length); if (!left) res(); };
      img.src = 'art/' + n + '_' + t + '.webp';
    });
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
    ctx.drawImage(s.img, li * fw, d * fh, fw, fh, -fw / 2 * k, -m.anchor * fh * k, fw * k, fh * k);
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
      ents: [], proj: [], fx: [], decals: [],
      energy: [5, 5], crowns: [0, 0],
      deck: [shuffle(opt.deck.slice()), shuffle(opt.enemy.deck.slice())],
      lvls: [opt.levels, opt.enemy.levels],
      sel: null, drag: null, hover: null, msg: [], shake: 0,
      ai: { think: 1.5, plan: null, lvl: opt.enemy.skill },
      arena: opt.arena,
    };
    for (const tm of [0, 1]) {
      const fy = y => tm ? H - y : y;
      G.ents.push(mkTower(tm, 'guard', 3.5, fy(25.5), 0, tm ? cmdAi : cmdMe));
      G.ents.push(mkTower(tm, 'guard', 14.5, fy(25.5), 1, tm ? cmdAi : cmdMe));
      G.ents.push(mkTower(tm, 'king', 9, fy(29), -1, tm ? cmdAi : cmdMe));
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
    if (u.targets === 'allies') return null;
    let best = null, bd = 1e9;
    for (const e of G.ents) {
      if (!e.alive || e.team === u.team || !canHit(u, e)) continue;
      const g = gap(u, e);
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
    if (e.kind === 'tower' && e.sub === 'king' && !e.active) { e.active = true; }
    if (e.hp <= 0) kill(e, src);
  }
  function kill(e) {
    e.alive = false; e.hp = 0;
    if (e.kind === 'tower') {
      const other = 1 - e.team;
      if (e.sub === 'king') { G.crowns[other] = 3; boom(e.x, e.y, 3.2, '#ffcf6a', 60); B.sfx('tower'); G.shake = 0.8; end(); }
      else {
        G.crowns[other] = Math.min(3, G.crowns[other] + 1);
        const k = G.ents.find(t => t.alive && t.kind === 'tower' && t.sub === 'king' && t.team === e.team); if (k) k.active = true;
        boom(e.x, e.y, 2.6, '#ffcf6a', 45); B.sfx('tower'); G.shake = 0.5;
        say(other === 0 ? 'Tower down!' : 'You lost a tower', 1.6, other === 0 ? '#7ff' : '#f98');
        if (G.overtime) end();
      }
      G.decals.push({ x: e.x, y: e.y, sub: e.sub, team: e.team });
    } else {
      boom(e.x, e.y, e.r * 1.4 + 0.4, e.team ? '#ff9a4a' : '#5fe8ff', e.kind === 'building' ? 26 : 14);
      B.sfx('boom');
    }
  }

  function boom(x, y, r, col, n) {
    G.fx.push({ type: 'ring', x, y, r: 0, R: r, t: 0, dur: 0.45, col });
    G.fx.push({ type: 'flash', x, y, r: r * 0.9, t: 0, dur: 0.25, col: '#fff3c4' });
    for (let i = 0; i < n; i++) {
      const a = rnd(0, 6.283), s = rnd(1, 4) * r * 0.6;
      G.fx.push({ type: 'spark', x, y, z: rnd(0, 0.6), vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rnd(1, 5), t: 0, dur: rnd(0.35, 0.9), col: i % 3 ? col : '#ffe9a8', size: rnd(0.05, 0.14) });
    }
    for (let i = 0; i < n / 3; i++) {
      G.fx.push({ type: 'smoke', x: x + rnd(-r, r) * 0.5, y: y + rnd(-r, r) * 0.5, z: rnd(0.2, 1), t: 0, dur: rnd(0.8, 1.5), size: rnd(0.4, 0.9) * r * 0.6 });
    }
  }

  function attack(u, e) {
    u.atkT = 0; u.anim = 'attack';
    const c = u.c;
    let amt = u.dmg;
    if (u.charging) { amt *= 2; u.charging = false; u.moved = 0; G.fx.push({ type: 'ring', x: e.x, y: e.y, r: 0, R: 1.4, t: 0, dur: 0.3, col: '#9ff' }); B.sfx('zap'); }
    if (u.kind === 'tower') {
      shoot(u, e, 'tower', amt); u.fireT = 0; B.sfx('shell'); return;
    }
    if (c && c.beam) return;   // the beam deals damage continuously
    if (c && c.proj) { shoot(u, e, c.proj, amt); B.sfx(c.proj === 'laser' ? 'laser' : 'shell'); return; }
    damage(e, amt, u); B.sfx('hit');
    const a = Math.atan2(e.y - u.y, e.x - u.x);
    for (let i = 0; i < 6; i++) G.fx.push({ type: 'spark', x: e.x - Math.cos(a) * e.r * 0.6, y: e.y - Math.sin(a) * e.r * 0.6, z: e.air ? 1.8 : 0.6, vx: rnd(-2, 2), vy: rnd(-2, 2), vz: rnd(0, 3), t: 0, dur: 0.3, col: u.team ? '#ffb05a' : '#8ff4ff', size: 0.07 });
  }
  function shoot(u, e, kind, amt) {
    const z0 = u.kind === 'tower' ? (u.sub === 'king' ? 3.1 : 2.4) : u.air ? 1.8 : kind === 'rocket' ? 1.3 : 0.9;
    const spd = { laser: 16, shell: 11, rocket: 8, tower: 13 }[kind];
    G.proj.push({ kind, team: u.team, x: u.x + Math.cos(u.face) * u.r * 0.8, y: u.y + Math.sin(u.face) * u.r * 0.8, z: z0, tgt: e, tx: e.x, ty: e.y, spd, dmg: amt,
      splash: u.c && u.c.splash || 0, src: u, targets: u.targets, trail: [] });
    G.fx.push({ type: 'muzzle', x: u.x + Math.cos(u.face) * (u.r + 0.3), y: u.y + Math.sin(u.face) * (u.r + 0.3), z: z0, t: 0, dur: 0.08, col: u.team ? '#ffb36a' : '#8ff' });
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
    for (const tm of [0, 1]) G.energy[tm] = Math.min(CB.ENERGY_MAX, G.energy[tm] + CB.ENERGY_RATE * mult * dt);

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
    if (u.stun > 0) { u.stun -= dt; u.anim = 'idle'; u.beamT = 0; return; }
    if (u.kind === 'building') { u.hp -= u.maxHp / u.life * dt; if (u.hp <= 0) return kill(u); }
    if (u.c.heal) return thinkMedic(u, dt);
    u.retarget -= dt; u.cd -= dt;
    const t = u.target;
    if (!t || !t.alive || u.retarget <= 0 && !u.locked || (t && !t.alive)) { u.target = findTarget(u); u.retarget = 0.3; u.locked = false; }
    const e = u.target;
    if (!e) { u.anim = 'idle'; return; }
    const g = gap(u, e);
    if (g <= u.range) {
      u.locked = true;
      u.face = turn(u.face, Math.atan2(e.y - u.y, e.x - u.x), dt * 10);
      if (u.c.beam) return beam(u, e, dt);
      if (u.cd <= 0) { attack(u, e); u.cd = u.hit; }
      else if (u.atkT > 0.5) u.anim = 'idle';
      u.moved = 0; u.charging = false;
      return;
    }
    u.locked = false; u.beamT = 0;
    if (u.kind === 'building') { u.anim = 'idle'; u.target = null; return; }
    if (u.atkT < 0.25) return;   // finish the swing
    const [wx, wy] = waypoint(u, e.x, e.y);
    const a = Math.atan2(wy - u.y, wx - u.x);
    let sp = u.speed * (u.charging ? 2 : 1);
    u.x += Math.cos(a) * sp * dt; u.y += Math.sin(a) * sp * dt; u.moved += sp * dt;
    if (u.c.charge && !u.charging && u.moved > 2) { u.charging = true; B.sfx('zap'); }
    u.face = turn(u.face, a, dt * 8); u.anim = 'walk'; u.walkPh += dt * sp / 1.4;
  }
  function turn(a, b, k) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + clamp(d, -k, k); }

  function beam(u, e, dt) {
    if (u.beamTarget !== e) { u.beamTarget = e; u.beamT = 0; }
    u.beamT += dt; u.anim = 'attack'; u.atkT = 0.1;
    u.cd -= 0; if (u.cd <= 0) {
      const st = u.beamT < 2 ? 0 : u.beamT < 4 ? 1 : 2;
      damage(e, Math.round(u.c.ramp[st] * CB.LVL_MUL(u.lvl)), u); u.cd = u.hit;
      B.sfx('beam');
      G.fx.push({ type: 'spark', x: e.x, y: e.y, z: e.air ? 1.8 : 0.7, vx: rnd(-2, 2), vy: rnd(-2, 2), vz: rnd(1, 3), t: 0, dur: 0.3, col: '#ffe08a', size: 0.08 + st * 0.03 });
    }
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
        boom(p.tx, p.ty, p.splash, p.team ? '#ff9a4a' : '#6fe8ff', 12); B.sfx('boom');
      } else {
        if (p.tgt && p.tgt.alive) damage(p.tgt, p.dmg, p.src);
        for (let i = 0; i < 4; i++) G.fx.push({ type: 'spark', x: p.tx, y: p.ty, z: tz, vx: rnd(-2, 2), vy: rnd(-2, 2), vz: rnd(0, 2), t: 0, dur: 0.25, col: p.team ? '#ffb05a' : '#8ff4ff', size: 0.06 });
      }
      return;
    }
    p.x += dx / d * s; p.y += dy / d * s; p.z += dz / d * s;
    if (p.kind === 'rocket') p.z += Math.sin(Math.min(1, G.t * 0)) * 0;
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
      G.fx.push({ type: 'beamdown', x, y, t: 0, dur: 0.6, col: team ? '#ffb06a' : '#7ff0ff', r: c.radius + 0.3 });
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
    if (s.card === 'missile') { boom(s.x, s.y, c.radius, '#ffb347', 40); B.sfx('boom'); G.shake = Math.max(G.shake, 0.35); }
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
      if (air) card = pick(['blaster', 'jet', 'rocket', 'colossus']);
      if (!card && swarm) card = pick(['rocket', 'emp', 'sentinel', 'colossus']);
      if (!card && big) card = pick(['spider', 'colossus', 'turret', 'hound', 'sentinel', 'blaster']);
      if (!card && tower) card = pick(['turret', 'spider', 'sentinel']);
      if (!card) card = pick(['sentinel', 'hound', 'blaster', 'jet', 'spider', 'rocket', 'turret', 'titan']);
      if (card && hp > 150) {
        const c = CB.CARDS[card]; let x, y;
        if (c.type === 'building') { x = clamp(front.x * 0.4 + 9 * 0.6, 6, 12); y = 7.5; }
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
      const tank = pick(['titan', 'colossus', 'sentinel', 'hound']);
      if (tank) {
        const behind = tank === 'titan' || tank === 'colossus';
        if (go(tank, lx + rnd(-0.5, 0.5), behind ? rnd(9, 13) : rnd(11, 13.5))) { ai.follow = { lane: lx, t: 2.5 }; return; }
      }
      const any = pick(['rocket', 'blaster', 'jet', 'spider', 'medic', 'hound', 'sentinel']);
      if (any && en >= 9.5) { go(any, lx + rnd(-1, 1), rnd(10, 13)); return; }
    }
    // support a push that just went out
    if (ai.follow && (ai.follow.t -= 1) < 0) {
      const sup = pick(['medic', 'rocket', 'blaster', 'jet', 'spider']);
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
    G = { t: 0, time: CB.MATCH_SECS, overtime: false, over: false, opt, ents: [], proj: [], fx: [], decals: [], energy: [5, 5], crowns: [0, 0],
      deck: [shuffle(opt.deck.slice()), shuffle(opt.enemy.deck.slice())], lvls: [opt.levels, opt.enemy.levels], msg: [], shake: 0,
      ai: { think: 1.5, lvl: opt.enemy.skill }, ai0: { think: 1.5, lvl: opt.skill }, arena: 0, sim: true };
    for (const tm of [0, 1]) {
      const fy = y => tm ? H - y : y;
      G.ents.push(mkTower(tm, 'guard', 3.5, fy(25.5), 0, tm ? opt.enemy.cmd : opt.cmd));
      G.ents.push(mkTower(tm, 'guard', 14.5, fy(25.5), 1, tm ? opt.enemy.cmd : opt.cmd));
      G.ents.push(mkTower(tm, 'king', 9, fy(29), -1, tm ? opt.enemy.cmd : opt.cmd));
    }
    let res = null; opt.onEnd = r => { res = r; };
    let n = 0;
    while (!G.over && n < 30 * 400) { step(DT); G.fx.length = 0; n++; }
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
    const needH = H * CB.SIN + 2.6;   // arena plus room for tall sprites at the top
    T = Math.min(VW / (W + 0.6), VH / needH);
    OX = (VW - W * T) / 2; OY = (VH - H * T * CB.SIN) / 2 + T * 0.9;
  }
  B.layout = () => { if (G) { layout(); buildBg(); } };

  function buildBg() {
    const A = CB.ARENAS[G.arena]; const img = B.arenaImg && B.arenaImg[G.arena];
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

  function draw() {
    const c = ctx; c.setTransform(DPR, 0, 0, DPR, 0, 0);
    let shx = 0, shy = 0; if (G.shake > 0) { shx = rnd(-1, 1) * G.shake * 6; shy = rnd(-1, 1) * G.shake * 6; }
    c.clearRect(0, 0, VW, VH);
    c.drawImage(bg, shx, shy, VW, VH);
    c.save(); c.translate(shx, shy);
    // river shimmer
    const A = CB.ARENAS[G.arena];
    c.globalAlpha = 0.25 + 0.1 * Math.sin(G.t * 3); c.fillStyle = A.glow;
    for (let i = 0; i < 6; i++) { const x = ((G.t * 1.3 + i * 3.3) % (W + 2)) - 1; c.fillRect(sx(x), sy(MIDY) - 1, T * 1.4, 2); }
    c.globalAlpha = 1;
    drawPlacement(c);
    for (const d of G.decals) B.drawSprite(c, d.sub === 'king' ? 'kingx' : 'guardx', TEAM[d.team], 'i0', 0, sx(d.x), sy(d.y), T);
    // shadows
    for (const e of G.ents) if (e.alive && e.kind !== 'tower') { c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(sx(e.x), sy(e.y), e.r * T * 1.05, e.r * T * 0.62, 0, 0, 7); c.fill(); }
    // spells in flight
    for (const s of G.spells || []) drawSpell(c, s);
    const list = G.ents.filter(e => e.alive).sort((a, b) => (a.air - b.air) || (a.y - b.y));
    for (const e of list) drawEnt(c, e);
    for (const p of G.proj) drawProj(c, p);
    drawFx(c);
    for (const e of list) drawBar(c, e);
    drawGhost(c);
    c.restore();
    drawMsgs(c);
  }

  function drawEnt(c, e) {
    const x = sx(e.x), y = sy(e.y, e.air ? 1.6 + Math.sin(G.t * 3 + e.id) * 0.08 : 0);
    if (e.kind === 'tower') {
      let lab = e.fireT < 0.12 ? 'a0' : e.fireT < 0.24 ? 'a1' : 'i0';
      const team = TEAM[e.team];
      if (!B.drawSprite(c, e.sub, team, lab, e.face, x, y, T)) fallback(c, e, x, y);
      if (e.sub === 'king' && !e.active) { c.fillStyle = 'rgba(255,255,255,.8)'; c.font = `bold ${T * 0.6}px system-ui`; c.textAlign = 'center'; c.fillText('z', x + T * 1.4, y - T * 2.4 - Math.sin(G.t * 2) * 3); }
      if (e.flash > 0) { c.globalAlpha = e.flash * 3; c.fillStyle = '#fff'; c.beginPath(); c.ellipse(x, y - T * 1.5, e.r * T, e.r * T * 1.2, 0, 0, 7); c.fill(); c.globalAlpha = 1; }
      return;
    }
    const sp = e.c.sprite; const team = TEAM[e.team];
    let lab = 'i0';
    if (e.kind === 'building') lab = e.atkT < 0.45 ? 'a' + Math.min(3, Math.floor(e.atkT / 0.11)) : 'i0';
    else if (e.air) lab = 'w' + (Math.floor(e.walkPh * 6 + G.t * 6) % 6);
    else if (e.anim === 'attack' && e.atkT < 0.5) lab = 'a' + Math.min(3, Math.floor(e.atkT / 0.12));
    else if (e.anim === 'attack' && e.c.beam) lab = 'a' + (Math.floor(G.t * 8) % 4);
    else if (e.anim === 'walk') lab = 'w' + (Math.floor(e.walkPh * 6) % 6);
    if (e.air && e.anim !== 'walk') e.walkPh += 0.01;
    let alpha = e.deploy > 0 ? 1 - e.deploy * 0.7 : 1;
    if (!B.drawSprite(c, sp, team, lab, e.face, x, y, T, alpha)) fallback(c, e, x, y);
    if (e.flash > 0) { c.globalAlpha = e.flash * 4; c.globalCompositeOperation = 'lighter'; c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y - e.r * T, e.r * T * 0.9, 0, 7); c.fill(); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; }
    if (e.stun > 0) { c.strokeStyle = '#9ff'; c.lineWidth = 2; for (let k = 0; k < 3; k++) { const a = G.t * 9 + k * 2.1; c.beginPath(); c.moveTo(x + Math.cos(a) * T * 0.5, y - T * 1.2 + Math.sin(a) * T * 0.2); c.lineTo(x + Math.cos(a + 0.8) * T * 0.4, y - T * 1.4); c.stroke(); } }
    if (e.charging) { c.globalCompositeOperation = 'lighter'; c.strokeStyle = 'rgba(140,240,255,.7)'; c.lineWidth = 2; for (let k = 0; k < 4; k++) { c.beginPath(); const yy = y - T * rnd(0.2, 0.9); c.moveTo(x - Math.cos(e.face) * T * rnd(0.6, 1.4), yy); c.lineTo(x - Math.cos(e.face) * T * rnd(1.6, 2.4), yy); c.stroke(); } c.globalCompositeOperation = 'source-over'; }
    if (e.c.beam && e.anim === 'attack' && e.beamTarget && e.beamTarget.alive && e.locked) drawBeam(c, e, e.beamTarget);
  }
  function fallback(c, e, x, y) {   // used only if a sprite sheet failed to load
    c.fillStyle = e.team ? '#d6452c' : '#2f6ae8'; c.beginPath(); c.arc(x, y - e.r * T, e.r * T, 0, 7); c.fill();
    c.fillStyle = '#fff'; c.font = `bold ${T * 0.5}px system-ui`; c.textAlign = 'center'; c.fillText(e.kind === 'tower' ? 'T' : e.c.name[0], x, y - e.r * T + T * 0.18);
  }
  function drawBeam(c, u, e) {
    const st = u.beamT < 2 ? 0 : u.beamT < 4 ? 1 : 2;
    const x0 = sx(u.x + Math.cos(u.face) * 1.3), y0 = sy(u.y + Math.sin(u.face) * 1.3, 2.1), x1 = sx(e.x), y1 = sy(e.y, e.air ? 1.8 : e.kind === 'tower' ? 1.5 : 0.6);
    c.save(); c.globalCompositeOperation = 'lighter';
    const col = u.team ? ['#ff8a3a', '#ffb04a', '#fff0a0'] : ['#3ad6ff', '#7ff0ff', '#ffffff'];
    const w = [3, 6, 11][st] * T / 24;
    c.strokeStyle = col[0]; c.globalAlpha = 0.5; c.lineWidth = w * 2.4 + Math.sin(G.t * 40) * 2; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    c.strokeStyle = col[1]; c.globalAlpha = 0.9; c.lineWidth = w; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    c.strokeStyle = col[2]; c.lineWidth = w * 0.35; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    c.globalAlpha = 0.8; c.fillStyle = col[1]; c.beginPath(); c.arc(x1, y1, w * 1.4, 0, 7); c.fill();
    c.restore();
  }
  function drawBar(c, e) {
    if (e.kind === 'tower') {
      if (!e.alive) return;
      const w = T * (e.sub === 'king' ? 3 : 2.4), x = sx(e.x) - w / 2, y = sy(e.y) - T * (e.sub === 'king' ? 5.0 : 4.0);
      c.fillStyle = 'rgba(0,0,0,.6)'; rr(c, x - 2, y - 2, w + 4, T * 0.42 + 4, 4); c.fill();
      c.fillStyle = e.team ? '#e5483a' : '#3aa0ff'; rr(c, x, y, w * Math.max(0, e.hp / e.maxHp), T * 0.42, 3); c.fill();
      c.fillStyle = '#fff'; c.font = `bold ${Math.max(9, T * 0.36)}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(Math.ceil(e.hp), x + w / 2, y + T * 0.22); c.textBaseline = 'alphabetic';
      return;
    }
    if (e.hp >= e.maxHp && e.kind !== 'building') return;
    const h = e.air ? 1.6 : 0; const ht = { titan: 3.6, colossus: 4.6, rocket: 2.6, sentinel: 2.3, blaster: 2.0, spider: 0.8, turret: 1.8, jet: 1.0, medic: 1.6, hound: 1.6 }[e.card] || 2;
    const w = Math.max(T * 0.7, e.r * T * 1.6), x = sx(e.x) - w / 2, y = sy(e.y, h + ht * 0.82);
    c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(x - 1, y - 1, w + 2, 5);
    c.fillStyle = e.team ? '#ff5a45' : '#45b4ff'; c.fillRect(x, y, w * Math.max(0, e.hp / e.maxHp), 3);
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  function drawProj(c, p) {
    const col = p.team ? ['#ff9a3a', '#ffe0a0'] : ['#3ae0ff', '#e0ffff'];
    c.save(); c.globalCompositeOperation = 'lighter';
    if (p.kind === 'laser' || p.kind === 'tower') {
      const t = p.trail[0] || [p.x, p.y, p.z];
      c.strokeStyle = col[0]; c.lineWidth = T * (p.kind === 'tower' ? 0.22 : 0.14); c.lineCap = 'round';
      c.beginPath(); c.moveTo(sx(t[0]), sy(t[1], t[2])); c.lineTo(sx(p.x), sy(p.y, p.z)); c.stroke();
      c.strokeStyle = col[1]; c.lineWidth *= 0.4; c.stroke();
    } else if (p.kind === 'shell') {
      c.fillStyle = col[0]; c.beginPath(); c.arc(sx(p.x), sy(p.y, p.z), T * 0.16, 0, 7); c.fill();
      c.fillStyle = col[1]; c.beginPath(); c.arc(sx(p.x), sy(p.y, p.z), T * 0.08, 0, 7); c.fill();
    } else {
      for (let i = 0; i < p.trail.length; i++) { const t = p.trail[i]; c.globalAlpha = i / p.trail.length * 0.5; c.fillStyle = '#9aa'; c.beginPath(); c.arc(sx(t[0]), sy(t[1], t[2]), T * 0.12 * (1 + (p.trail.length - i) * 0.1), 0, 7); c.fill(); }
      c.globalAlpha = 1; c.fillStyle = '#ffd27a'; c.beginPath(); c.arc(sx(p.x), sy(p.y, p.z), T * 0.14, 0, 7); c.fill();
    }
    c.restore();
  }

  function drawSpell(c, s) {
    const C = CB.CARDS[s.card];
    c.save();
    c.strokeStyle = s.team ? 'rgba(255,140,60,.6)' : 'rgba(80,220,255,.6)'; c.lineWidth = 2; c.setLineDash([6, 5]);
    c.beginPath(); c.ellipse(sx(s.x), sy(s.y), C.radius * T, C.radius * T * CB.SIN, 0, 0, 7); c.stroke(); c.setLineDash([]);
    if (s.card === 'missile') {
      const k = s.t / s.dur; const x = s.sx + (s.x - s.sx) * k, y = s.sy + (s.y - s.sy) * k, z = 3 + Math.sin(k * Math.PI) * 6 * (1 - k * 0.3) - k * 3;
      c.globalCompositeOperation = 'lighter';
      for (let i = 1; i < 8; i++) { const kk = Math.max(0, k - i * 0.025); const xx = s.sx + (s.x - s.sx) * kk, yy = s.sy + (s.y - s.sy) * kk, zz = 3 + Math.sin(kk * Math.PI) * 6 * (1 - kk * 0.3) - kk * 3; c.globalAlpha = 0.5 - i * 0.05; c.fillStyle = '#ffb347'; c.beginPath(); c.arc(sx(xx), sy(yy, zz), T * (0.35 - i * 0.03), 0, 7); c.fill(); }
      c.globalAlpha = 1; c.fillStyle = '#fff2c0'; c.beginPath(); c.arc(sx(x), sy(y, z), T * 0.3, 0, 7); c.fill();
    }
    c.restore();
  }

  function drawFx(c) {
    const dt = DT;
    c.save();
    for (const f of G.fx) {
      f.t += 1 / 60; const k = f.t / f.dur; if (k >= 1) { f.done = true; continue; }
      if (f.type === 'ring') {
        c.globalCompositeOperation = 'lighter'; c.strokeStyle = f.col; c.globalAlpha = 1 - k; c.lineWidth = T * 0.18 * (1 - k) + 1;
        c.beginPath(); c.ellipse(sx(f.x), sy(f.y), f.R * k * T, f.R * k * T * CB.SIN, 0, 0, 7); c.stroke();
      } else if (f.type === 'flash') {
        c.globalCompositeOperation = 'lighter'; const g = c.createRadialGradient(sx(f.x), sy(f.y, 0.6), 0, sx(f.x), sy(f.y, 0.6), f.r * T * 1.4);
        g.addColorStop(0, `rgba(255,245,200,${1 - k})`); g.addColorStop(1, 'rgba(255,140,40,0)'); c.fillStyle = g; c.globalAlpha = 1;
        c.beginPath(); c.arc(sx(f.x), sy(f.y, 0.6), f.r * T * 1.4, 0, 7); c.fill();
      } else if (f.type === 'spark') {
        f.x += f.vx / 60; f.y += f.vy / 60; f.z = Math.max(0, f.z + f.vz / 60); f.vz -= 9 / 60;
        c.globalCompositeOperation = 'lighter'; c.globalAlpha = 1 - k; c.fillStyle = f.col;
        c.fillRect(sx(f.x) - f.size * T / 2, sy(f.y, f.z) - f.size * T / 2, f.size * T, f.size * T);
      } else if (f.type === 'smoke') {
        c.globalCompositeOperation = 'source-over'; c.globalAlpha = 0.45 * (1 - k); c.fillStyle = '#3a3a40';
        c.beginPath(); c.arc(sx(f.x), sy(f.y, f.z + k * 1.5), f.size * T * (0.6 + k), 0, 7); c.fill();
      } else if (f.type === 'muzzle') {
        c.globalCompositeOperation = 'lighter'; c.globalAlpha = 1 - k; c.fillStyle = f.col;
        c.beginPath(); c.arc(sx(f.x), sy(f.y, f.z), T * 0.3, 0, 7); c.fill();
      } else if (f.type === 'emp') {
        c.globalCompositeOperation = 'lighter';
        for (let r = 0; r < 3; r++) { const kk = clamp(k * 1.3 - r * 0.15, 0, 1); c.globalAlpha = (1 - kk) * 0.9; c.strokeStyle = '#8ff6ff'; c.lineWidth = 3;
          c.beginPath(); c.ellipse(sx(f.x), sy(f.y), f.R * kk * T, f.R * kk * T * CB.SIN, 0, 0, 7); c.stroke(); }
        c.globalAlpha = (1 - k) * 0.25; c.fillStyle = '#8ff6ff'; c.beginPath(); c.ellipse(sx(f.x), sy(f.y), f.R * T, f.R * T * CB.SIN, 0, 0, 7); c.fill();
        c.globalAlpha = 1 - k; c.strokeStyle = '#e8ffff'; c.lineWidth = 1.5;
        for (let i = 0; i < 6; i++) { let a = rnd(0, 6.28), x = sx(f.x), y = sy(f.y, 0.3); c.beginPath(); c.moveTo(x, y); for (let j = 1; j < 5; j++) { x += Math.cos(a) * f.R * T / 5 + rnd(-4, 4); y += Math.sin(a) * f.R * T * CB.SIN / 5 + rnd(-4, 4); c.lineTo(x, y); } c.stroke(); }
      } else if (f.type === 'beamdown') {
        c.globalCompositeOperation = 'lighter'; c.globalAlpha = (1 - k) * 0.7;
        const g = c.createLinearGradient(0, sy(f.y, 6), 0, sy(f.y)); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, f.col);
        c.fillStyle = g; c.fillRect(sx(f.x) - f.r * T * (1 - k * 0.5), sy(f.y, 6), f.r * T * 2 * (1 - k * 0.5), sy(f.y) - sy(f.y, 6));
      }
    }
    c.restore();
    G.fx = G.fx.filter(f => !f.done);
    if (G.fx.length > 600) G.fx.splice(0, G.fx.length - 600);
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
      if (!B.drawSprite(c, C.sprite, 'blue', C.air ? 'w0' : 'i0', -Math.PI / 2, sx(h.x + ox), sy(h.y + oy, C.air ? 1.6 : 0), T, ok ? 0.65 : 0.35)) { c.fillStyle = '#4af'; c.beginPath(); c.arc(sx(h.x + ox), sy(h.y + oy), T * 0.4, 0, 7); c.fill(); }
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
    while (acc >= DT) { if (!G.over) step(DT); acc -= DT; if (!G) return; }
    G.shake = Math.max(0, G.shake - el);
    draw(); hud();
    requestAnimationFrame(frame);
  }
  B.G = () => G;
})();
