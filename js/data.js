// Core Breakers: card, arena, chest and level tables. Everything balance-related lives here.
'use strict';
const CB = window.CB = {};

// Arena is 18 x 32 tiles. 1 tile = 1 metre in the renders. Player at the bottom (y large), enemy at the top.
CB.W = 18; CB.H = 32;
CB.RIVER = [15, 17];                 // river band (y)
CB.BRIDGES = [[2.5, 4.5], [13.5, 15.5]];  // bridge x spans
CB.EL = 50 * Math.PI / 180;          // camera elevation used for the renders
CB.SIN = Math.sin(CB.EL); CB.COS = Math.cos(CB.EL);

CB.RARITY = {
  common:    { name: 'Common',    color: '#9fb4c8', need: [2, 4, 10, 20, 50, 100, 200, 400, 800], goldMul: 1,  xp: 1 },
  rare:      { name: 'Rare',      color: '#ff9d3c', need: [2, 4, 8, 15, 30, 50, 100, 200, 300],   goldMul: 2,  xp: 2 },
  epic:      { name: 'Epic',      color: '#c25cff', need: [2, 4, 6, 10, 20, 30, 50, 80, 120],     goldMul: 4,  xp: 4 },
  legendary: { name: 'Legendary', color: '#5cf2ff', need: [1, 2, 3, 5, 8, 12, 18, 25, 35],        goldMul: 6,  xp: 8 },
};
CB.MAXLVL = 10;
CB.UPGRADE_GOLD = [5, 20, 50, 150, 400, 1000, 2000, 4000, 8000];   // to go from level i+1 to i+2
CB.UPGRADE_XP = [4, 5, 6, 10, 25, 50, 100, 200, 400];
CB.CMD_XP = [20, 50, 100, 200, 400, 800, 1500, 2500, 4000];          // commander level-ups
CB.LVL_MUL = l => Math.pow(1.1, l - 1);                               // card power per level
CB.CMD_MUL = l => Math.pow(1.08, l - 1);                              // tower power per commander level

// Card stats are level 1. hp/dmg scale by LVL_MUL. speed in tiles/s, hit = seconds between attacks,
// range in tiles (edge to edge), sight = how far it looks for targets. targets: 'ground' | 'air' | 'both' | 'buildings'.
CB.CARDS = {
  sentinel: { name: 'Sentinel', rarity: 'common', cost: 3, type: 'troop', sprite: 'sentinel',
    desc: 'Armoured guard with an energy blade and shield. Tough and dependable.',
    hp: 800, dmg: 95, hit: 1.2, range: 0.8, sight: 5.5, speed: 1.0, targets: 'ground', radius: 0.45, mass: 6, count: 1, arena: 0 },
  blaster: { name: 'Blaster Bots', rarity: 'common', cost: 3, type: 'troop', sprite: 'blaster',
    desc: 'Two rifle troopers. Shoot ground and air from range.',
    hp: 260, dmg: 72, hit: 1.1, range: 5, sight: 6, speed: 1.0, targets: 'both', radius: 0.4, mass: 4, count: 2, arena: 0, proj: 'plasma' },
  spider: { name: 'Spider Swarm', rarity: 'common', cost: 2, type: 'troop', sprite: 'spider',
    desc: 'Six fast spider drones. Shred big robots, but splash wipes them out.',
    hp: 72, dmg: 38, hit: 1.0, range: 0.4, sight: 5.5, speed: 1.55, targets: 'ground', radius: 0.3, mass: 1, count: 6, arena: 0 },
  turret: { name: 'Turret', rarity: 'common', cost: 3, type: 'building', sprite: 'turret',
    desc: 'Twin cannon that pulls in tower-attackers. Hits ground only. Wears down over 30 s.',
    hp: 660, dmg: 82, hit: 0.85, range: 5.5, sight: 5.5, speed: 0, targets: 'ground', radius: 0.8, mass: 99, count: 1, arena: 0, life: 30, proj: 'tracer' },
  jet: { name: 'Strike Jets', rarity: 'common', cost: 3, type: 'troop', sprite: 'jet', air: true,
    desc: 'Three flying fighters. Ground melee robots cannot touch them.',
    hp: 170, dmg: 58, hit: 1.0, range: 2.5, sight: 5.5, speed: 1.5, targets: 'both', radius: 0.45, mass: 2, count: 3, arena: 0, proj: 'minimissile' },
  emp: { name: 'EMP Blast', rarity: 'common', cost: 2, type: 'spell',
    desc: 'Small blast that stuns every robot it hits for 1.2 seconds.',
    dmg: 150, towerPct: 0.4, radius: 2.5, stun: 1.2, arena: 0 },
  titan: { name: 'Titan', rarity: 'rare', cost: 5, type: 'troop', sprite: 'titan',
    desc: 'Huge brute that only goes after buildings and towers. Soaks up damage.',
    hp: 2900, dmg: 175, hit: 1.5, range: 0.9, sight: 7, speed: 0.7, targets: 'buildings', radius: 0.95, mass: 18, count: 1, arena: 0 },
  missile: { name: 'Missile Strike', rarity: 'rare', cost: 4, type: 'spell',
    desc: 'Heavy missile. Big area damage and knocks small robots back.',
    dmg: 340, towerPct: 0.3, radius: 2.5, knock: 1.2, arena: 0 },
  medic: { name: 'Repair Drone', rarity: 'rare', cost: 4, type: 'troop', sprite: 'medic',
    desc: 'Hovers behind your robots and repairs everything nearby. Cannot attack.',
    hp: 520, dmg: 0, heal: 70, healR: 3.2, hit: 1.0, range: 3.5, sight: 7, speed: 1.0, targets: 'allies', radius: 0.45, mass: 4, count: 1, arena: 1 },
  rocket: { name: 'Rocket Strider', rarity: 'rare', cost: 5, type: 'troop', sprite: 'rocket',
    desc: 'Walker with missile pods. Splash damage hits everything near the target, ground and air.',
    hp: 640, dmg: 165, splash: 1.6, hit: 1.7, range: 5.5, sight: 6, speed: 0.9, targets: 'both', radius: 0.65, mass: 8, count: 1, arena: 1, proj: 'rocket' },
  hound: { name: 'Volt Hound', rarity: 'epic', cost: 4, type: 'troop', sprite: 'hound',
    desc: 'After running 2 tiles it charges: double speed and its first bite does double damage.',
    hp: 980, dmg: 190, hit: 1.4, range: 0.8, sight: 5.5, speed: 1.05, targets: 'ground', radius: 0.55, mass: 7, count: 1, arena: 2, charge: true },
  colossus: { name: 'Colossus', rarity: 'legendary', cost: 7, type: 'troop', sprite: 'colossus',
    desc: 'Legendary war machine. Its beam cannon burns hotter the longer it hits one target.',
    hp: 2600, dmg: 30, ramp: [30, 85, 250], hit: 0.4, range: 5, sight: 6.5, speed: 0.7, targets: 'both', radius: 1.1, mass: 20, count: 1, arena: 3, beam: true },
  boombot: { name: 'Boom Bots', rarity: 'common', cost: 2, type: 'troop', sprite: 'boombot',
    desc: 'Two rolling bombs that race to the nearest building and explode, hitting everything around it.',
    hp: 230, dmg: 290, splash: 1.6, hit: 1, range: 0.3, sight: 7, speed: 1.9, targets: 'buildings', radius: 0.35, mass: 2, count: 2, arena: 0, kamikaze: true },
  arc: { name: 'Arc Trooper', rarity: 'common', cost: 3, type: 'troop', sprite: 'arc',
    desc: 'Chain lightning: hits its target, then jumps to 2 more enemies nearby.',
    hp: 440, dmg: 95, hit: 1.4, range: 4.5, sight: 6, speed: 1.0, targets: 'both', radius: 0.45, mass: 5, count: 1, arena: 0, chain: 2, proj: 'chain' },
  bombard: { name: 'Bombard', rarity: 'rare', cost: 4, type: 'troop', sprite: 'bombard',
    desc: 'Mortar walker. Lobs shells very far with a big splash, but cannot hit enemies close to it.',
    hp: 540, dmg: 180, splash: 1.8, hit: 3.2, range: 11, minRange: 3, sight: 11.5, speed: 0.65, targets: 'ground', radius: 0.6, mass: 8, count: 1, arena: 1, proj: 'mortar' },
  hive: { name: 'Drone Hive', rarity: 'rare', cost: 5, type: 'building', sprite: 'hive',
    desc: 'Launches 2 attack drones every 6 seconds. Lasts 35 seconds.',
    hp: 750, dmg: 0, hit: 6, range: 0, sight: 0, speed: 0, targets: 'none', radius: 0.8, mass: 99, count: 1, arena: 1, life: 35, spawn: { id: 'minidrone', n: 2 } },
  cryo: { name: 'Cryo Walker', rarity: 'rare', cost: 4, type: 'troop', sprite: 'cryo',
    desc: 'Frost beam that damages and SLOWS its target and every enemy around it.',
    hp: 950, dmg: 48, hit: 0.5, range: 3.5, sight: 5.5, speed: 0.8, targets: 'both', radius: 0.6, mass: 10, count: 1, arena: 2, beam: true, frost: { r: 1.4, slow: 0.45, t: 1.6 } },
  rail: { name: 'Rail Lancer', rarity: 'epic', cost: 5, type: 'troop', sprite: 'rail',
    desc: 'Railgun shot PIERCES in a straight line, hitting every enemy in its path for 7 tiles.',
    hp: 560, dmg: 300, hit: 2.6, range: 6.5, sight: 7, speed: 0.9, targets: 'both', radius: 0.5, mass: 6, count: 1, arena: 2, pierce: 7, proj: 'rail' },
  scorcher: { name: 'Scorcher', rarity: 'epic', cost: 4, type: 'troop', sprite: 'scorcher',
    desc: 'Flame tank. Its flamethrower burns everything in a cone in front of it.',
    hp: 1100, dmg: 48, hit: 0.25, range: 2.2, sight: 5.5, speed: 0.9, targets: 'ground', radius: 0.7, mass: 12, count: 1, arena: 3, cone: { r: 2.9, a: 0.6 } },
  bomber: { name: 'Sky Bomber', rarity: 'epic', cost: 5, type: 'troop', sprite: 'bomber', air: true,
    desc: 'Flying fortress. Heads straight for buildings and drops heavy bombs with a big splash.',
    hp: 1400, dmg: 360, splash: 1.5, hit: 2.4, range: 0.4, sight: 7, speed: 0.85, targets: 'buildings', radius: 0.75, mass: 10, count: 1, arena: 3, proj: 'bomb' },
  minidrone: { name: 'Mini Drone', rarity: 'common', cost: 0, type: 'troop', sprite: 'minidrone', air: true, token: true,
    desc: 'Launched by the Drone Hive.',
    hp: 95, dmg: 34, hit: 0.9, range: 1.8, sight: 5.5, speed: 1.6, targets: 'both', radius: 0.3, mass: 1, count: 1, arena: 9, proj: 'pulse' },
};
CB.CARD_ORDER = ['sentinel', 'blaster', 'spider', 'turret', 'jet', 'emp', 'boombot', 'arc', 'titan', 'missile', 'medic', 'rocket', 'bombard', 'hive', 'cryo', 'rail', 'hound', 'scorcher', 'bomber', 'colossus'];
CB.START_DECK = ['sentinel', 'blaster', 'spider', 'turret', 'jet', 'emp', 'titan', 'missile'];

CB.TOWERS = {
  guard: { hp: 1350, dmg: 50, hit: 0.8, range: 8.5, radius: 1.45, sprite: 'guard' },
  king:  { hp: 2600, dmg: 60, hit: 1.0, range: 7.0, radius: 1.9, sprite: 'king' },
};

CB.ARENAS = [
  { name: 'Green Fields',  trophies: 0,    floor: '#4f8a2c', glow: '#7fd0ff', tint: '#6a8a4a', gold: 15 },
  { name: 'Desert Canyon', trophies: 300,  floor: '#d9b26b', glow: '#5fe0d0', tint: '#b8955f', gold: 20 },
  { name: 'Frozen Peaks',  trophies: 700,  floor: '#c9d6e4', glow: '#9ff0ff', tint: '#8fa2b8', gold: 25 },
  { name: 'Neon City',     trophies: 1200, floor: '#3a3d46', glow: '#ff4fd8', tint: '#5a4a80', gold: 30 },
  { name: 'Volcano Core',  trophies: 1800, floor: '#2b2523', glow: '#ff6a2a', tint: '#7a3a3a', gold: 40 },
];
CB.arenaOf = t => { let a = 0; CB.ARENAS.forEach((x, i) => { if (t >= x.trophies) a = i; }); return a; };

// Chests: minutes to unlock, card count and gold (both grow with arena), guaranteed rarities.
CB.CHESTS = {
  silver: { name: 'Silver Chest', mins: 15,  cards: [8, 3],   gold: [30, 8],   color: '#c9d3de' },
  gold:   { name: 'Gold Chest',   mins: 60,  cards: [24, 8],  gold: [110, 30], color: '#ffc63a', rare: 2 },
  magic:  { name: 'Magic Chest',  mins: 240, cards: [70, 20], gold: [400, 90], color: '#c25cff', rare: 8, epic: 2 },
  mega:   { name: 'Mega Chest',   mins: 480, cards: [200, 50], gold: [1100, 250], color: '#5cf2ff', rare: 25, epic: 6, legendary: 0.35 },
  free:   { name: 'Free Chest',   mins: 0,   cards: [5, 2],   gold: [20, 6],   color: '#7ee08a' },
  crown:  { name: 'Crown Chest',  mins: 0,   cards: [30, 10], gold: [250, 60], color: '#ff7a3a', rare: 3, epic: 0.4 },
};
CB.CHEST_CYCLE = ['silver', 'silver', 'gold', 'silver', 'silver', 'gold', 'silver', 'silver', 'silver', 'magic',
  'silver', 'gold', 'silver', 'silver', 'gold', 'silver', 'silver', 'gold', 'silver', 'mega'];
CB.OPEN_NOW_GOLD_PER_MIN = 4;
CB.FREE_CHEST_HOURS = 4;
CB.CROWNS_FOR_CHEST = 10;

CB.MATCH_SECS = 180; CB.DOUBLE_AT = 60; CB.OVERTIME_SECS = 60;
CB.ENERGY_MAX = 10; CB.ENERGY_RATE = 1 / 2.8;  // per second, x2 in double time, x3 in overtime
