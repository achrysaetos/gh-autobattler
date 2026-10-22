import {
  NEUTRAL,
  Terrain,
  UnitKind,
  type FactionState,
  type Hex,
  type MapDef,
  type ObjectiveDef,
  type ObjectiveState,
  type PlayerState,
  type RoundParams,
  type SimInput,
  type TickEvents,
  type Unit,
  type World,
  type WorldSnapshot,
} from '../../sim/api.ts';

const NAV_CELL = 10;
const HEX_SIZE = 30;
const HASH_CELL = 50;
const COUNCIL_TICKS = 30;
const RESPAWN_TICKS = 200;
const CAPTURE_TICKS = 60;
const DOMINATION_TICKS = 6 * 60 * 60 * 10;

interface KindStats {
  hp: number;
  damage: number;
  range: number;
  aggro: number;
  speed: number;
  cooldown: number;
}

const KIND_STATS: readonly KindStats[] = [
  { hp: 120, damage: 12, range: 9, aggro: 70, speed: 1.5, cooldown: 10 },
  { hp: 70, damage: 9, range: 75, aggro: 110, speed: 2.0, cooldown: 14 },
  { hp: 100, damage: 15, range: 10, aggro: 90, speed: 3.1, cooldown: 12 },
];

const BEATS: readonly UnitKind[] = [UnitKind.Cavalry, UnitKind.Infantry, UnitKind.Archer];

function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number, seed: number): number {
  return (
    valueNoise(x, y, seed) * 0.55 +
    valueNoise(x * 2.1, y * 2.1, seed + 17) * 0.3 +
    valueNoise(x * 4.3, y * 4.3, seed + 31) * 0.15
  );
}

function nextRandom(world: World): number {
  let t = (world.rng = (world.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function generateMap(params: RoundParams): MapDef {
  const F = Math.max(1, params.factionCount);
  const radius = Math.max(700, Math.sqrt((params.expectedUnits * 1100) / Math.PI));
  const navCols = Math.ceil((2 * radius) / NAV_CELL) + 2;
  const navRows = navCols;
  const originX = -(navCols * NAV_CELL) / 2;
  const originY = -(navRows * NAV_CELL) / 2;

  const objectives: ObjectiveDef[] = [];
  const sector = (Math.PI * 2) / F;
  const garrison = Math.max(4, Math.round(params.expectedUnits / (F * 14)));
  for (let i = 0; i < F; i++) {
    const a = i * sector - Math.PI / 2;
    objectives.push({
      id: objectives.length,
      kind: 'base',
      x: Math.cos(a) * radius * 0.82,
      y: Math.sin(a) * radius * 0.82,
      radius: 60,
      pointsPerSecond: 0,
      homeFaction: i,
      garrison: 0,
    });
  }
  for (let i = 0; i < F; i++) {
    const a = i * sector - Math.PI / 2;
    const near = a + sector * 0.12;
    const between = a + sector * 0.5;
    for (const [ang, r] of [
      [near, 0.42],
      [between, 0.66],
    ] as const) {
      objectives.push({
        id: objectives.length,
        kind: 'stronghold',
        x: Math.cos(ang) * radius * r,
        y: Math.sin(ang) * radius * r,
        radius: 45,
        pointsPerSecond: 5,
        homeFaction: NEUTRAL,
        garrison,
      });
    }
  }
  objectives.push({
    id: objectives.length,
    kind: 'citadel',
    x: 0,
    y: 0,
    radius: 70,
    pointsPerSecond: 15,
    homeFaction: NEUTRAL,
    garrison: garrison * 2,
  });

  const terrain = new Uint8Array(navCols * navRows);
  const seed = params.seed | 0;
  for (let row = 0; row < navRows; row++) {
    for (let col = 0; col < navCols; col++) {
      const x = originX + (col + 0.5) * NAV_CELL;
      const y = originY + (row + 0.5) * NAV_CELL;
      const d = Math.hypot(x, y);
      const idx = row * navCols + col;
      if (d > radius) {
        terrain[idx] = Terrain.Void;
        continue;
      }
      let local = Math.atan2(y, x) + Math.PI / 2;
      local = ((local % sector) + sector) % sector;
      const fx = (Math.cos(local) * d) / 140;
      const fy = (Math.sin(local) * d) / 140;
      let clear = d < 110 || d > radius - 18;
      for (const o of objectives) {
        if (Math.hypot(x - o.x, y - o.y) < o.radius + 45) clear = true;
      }
      const forest = fbm(fx, fy, seed + 101);
      const water = fbm(fx * 0.7 + 40, fy * 0.7 - 13, seed + 202);
      const rock = fbm(fx * 1.6 - 9, fy * 1.6 + 5, seed + 303);
      let t: Terrain = Terrain.Plain;
      if (!clear && water > 0.7) t = Terrain.Water;
      else if (!clear && rock > 0.74) t = Terrain.Rock;
      else if (forest > 0.6) t = Terrain.Forest;
      terrain[idx] = t;
    }
  }

  const hexes: Hex[] = [];
  const span = Math.ceil(radius / (HEX_SIZE * 1.5)) + 1;
  for (let r = -span; r <= span; r++) {
    for (let q = -span * 2; q <= span * 2; q++) {
      const x = HEX_SIZE * Math.sqrt(3) * (q + r / 2);
      const y = HEX_SIZE * 1.5 * r;
      if (Math.hypot(x, y) > radius - HEX_SIZE * 0.6) continue;
      const col = Math.floor((x - originX) / NAV_CELL);
      const row = Math.floor((y - originY) / NAV_CELL);
      const t = terrain[row * navCols + col];
      if (t === Terrain.Water || t === Terrain.Rock) continue;
      hexes.push({ q, r, x, y });
    }
  }

  return { radius, navCell: NAV_CELL, navCols, navRows, originX, originY, terrain, hexSize: HEX_SIZE, hexes, objectives };
}

function spawnUnit(world: World, playerId: number, faction: number, kind: UnitKind, cx: number, cy: number, spread: number, rankMult: number): Unit {
  let x = cx;
  let y = cy;
  for (let tries = 0; tries < 8; tries++) {
    const ox = (nextRandom(world) * 2 - 1) * spread;
    const oy = (nextRandom(world) * 2 - 1) * spread;
    if (ox * ox + oy * oy > spread * spread) continue;
    if (passable(world.map, cx + ox, cy + oy)) {
      x = cx + ox;
      y = cy + oy;
      break;
    }
  }
  const stats = KIND_STATS[kind]!;
  const hp = stats.hp * rankMult;
  const unit: Unit = { id: world.nextUnitId++, playerId, faction, kind, x, y, hp, maxHp: hp, targetUnitId: -1, cooldown: 0, bornTick: world.tick };
  world.units.push(unit);
  return unit;
}

function terrainAt(map: MapDef, x: number, y: number): number {
  const col = Math.floor((x - map.originX) / map.navCell);
  const row = Math.floor((y - map.originY) / map.navCell);
  if (col < 0 || row < 0 || col >= map.navCols || row >= map.navRows) return Terrain.Void;
  return map.terrain[row * map.navCols + col]!;
}

function passable(map: MapDef, x: number, y: number): boolean {
  const t = terrainAt(map, x, y);
  return t === Terrain.Plain || t === Terrain.Forest;
}

export function createWorld(params: RoundParams, map: MapDef): World {
  const factions: FactionState[] = [];
  for (let i = 0; i < params.factionCount; i++) factions.push({ id: i, score: 0, hexesHeld: 0, objectivesHeld: 0 });
  const objectives: ObjectiveState[] = map.objectives.map((o) => ({ id: o.id, owner: o.homeFaction, capturer: NEUTRAL, progress: 0 }));
  const territory = new Int8Array(map.hexes.length).fill(NEUTRAL);
  map.hexes.forEach((h, i) => {
    for (const o of map.objectives) {
      if (o.kind === 'base' && Math.hypot(h.x - o.x, h.y - o.y) < o.radius * 1.9) territory[i] = o.homeFaction;
    }
  });
  const world: World = {
    tick: 0,
    params,
    map,
    rng: params.seed | 0,
    nextUnitId: 1,
    units: [],
    players: [],
    factions,
    objectives,
    territory,
    dominationFaction: NEUTRAL,
    dominationSince: 0,
    winner: NEUTRAL,
  };
  for (const o of map.objectives) {
    for (let g = 0; g < o.garrison; g++) {
      const kind = (g % 3) as UnitKind;
      spawnUnit(world, NEUTRAL, NEUTRAL, kind, o.x, o.y, o.radius * 0.7, 1);
    }
  }
  return world;
}

function rankMultiplier(rank: number): number {
  return 1 + 0.08 * rank;
}

function playerBase(world: World, faction: number): ObjectiveDef {
  return world.map.objectives.find((o) => o.kind === 'base' && o.homeFaction === faction) ?? world.map.objectives[0]!;
}

function applyInput(world: World, input: SimInput, events: TickEvents, alive: Map<number, number[]>): void {
  if (input.kind === 'enlist') {
    if (world.players.some((p) => p.playerId === input.playerId)) return;
    world.players.push({
      playerId: input.playerId,
      faction: input.faction,
      target: [0, 0, 0],
      rank: 0,
      respawnAt: [0, 0, 0],
      orderObjectiveId: -1,
      kills: 0,
      losses: 0,
      captures: 0,
    });
    return;
  }
  const player = world.players.find((p) => p.playerId === input.playerId);
  if (!player) return;
  player.target = [input.infantry, input.archers, input.cavalry];
  player.rank = input.rank;
  const counts = alive.get(player.playerId) ?? [0, 0, 0];
  const base = playerBase(world, player.faction);
  for (let k = 0; k < 3; k++) {
    const missing = player.target[k]! - counts[k]!;
    for (let n = 0; n < missing; n++) {
      const u = spawnUnit(world, player.playerId, player.faction, k as UnitKind, base.x, base.y, base.radius * 0.8, rankMultiplier(player.rank));
      events.spawns.push({ unitId: u.id, playerId: player.playerId, kind: u.kind });
    }
    if (missing > 0) counts[k] = player.target[k]!;
  }
  alive.set(player.playerId, counts);
}

function countAlive(world: World): Map<number, number[]> {
  const alive = new Map<number, number[]>();
  for (const u of world.units) {
    let c = alive.get(u.playerId);
    if (!c) alive.set(u.playerId, (c = [0, 0, 0]));
    c[u.kind]!++;
  }
  return alive;
}

function runCouncil(world: World, faction: number): void {
  const members = world.players.filter((p) => p.faction === faction);
  if (members.length === 0) return;
  const base = playerBase(world, faction);
  const scored = world.map.objectives
    .filter((o) => o.kind !== 'base')
    .map((o) => {
      const owned = world.objectives[o.id]!.owner === faction;
      const dist = Math.hypot(o.x - base.x, o.y - base.y) / world.map.radius;
      const value = o.pointsPerSecond * (owned ? 0.35 : 1) - dist * 6 + nextRandom(world) * 3;
      return { id: o.id, value };
    })
    .sort((a, b) => b.value - a.value || a.id - b.id);
  const fronts = Math.max(1, Math.min(3, Math.ceil(members.length / 3)));
  members.forEach((p, i) => {
    p.orderObjectiveId = scored[i % Math.min(fronts, scored.length)]?.id ?? -1;
  });
}

interface SpatialHash {
  cols: number;
  rows: number;
  minX: number;
  minY: number;
  head: Int32Array;
  next: Int32Array;
}

function buildHash(world: World): SpatialHash {
  const extent = world.map.radius + HASH_CELL;
  const cols = Math.ceil((extent * 2) / HASH_CELL);
  const head = new Int32Array(cols * cols).fill(-1);
  const next = new Int32Array(world.units.length);
  const hash = { cols, rows: cols, minX: -extent, minY: -extent, head, next };
  world.units.forEach((u, i) => {
    const c = cellOf(hash, u.x, u.y);
    next[i] = head[c]!;
    head[c] = i;
  });
  return hash;
}

function cellOf(h: SpatialHash, x: number, y: number): number {
  const col = Math.max(0, Math.min(h.cols - 1, Math.floor((x - h.minX) / HASH_CELL)));
  const row = Math.max(0, Math.min(h.rows - 1, Math.floor((y - h.minY) / HASH_CELL)));
  return row * h.cols + col;
}

function forEachNear(h: SpatialHash, x: number, y: number, r: number, fn: (index: number) => void): void {
  const c0 = Math.max(0, Math.floor((x - r - h.minX) / HASH_CELL));
  const c1 = Math.min(h.cols - 1, Math.floor((x + r - h.minX) / HASH_CELL));
  const r0 = Math.max(0, Math.floor((y - r - h.minY) / HASH_CELL));
  const r1 = Math.min(h.rows - 1, Math.floor((y + r - h.minY) / HASH_CELL));
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      for (let i = h.head[row * h.cols + col]!; i !== -1; i = h.next[i]!) fn(i);
    }
  }
}

function moveToward(world: World, u: Unit, tx: number, ty: number, stopAt: number): void {
  const dx = tx - u.x;
  const dy = ty - u.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= stopAt || d === 0) return;
  let speed = KIND_STATS[u.kind]!.speed;
  if (terrainAt(world.map, u.x, u.y) === Terrain.Forest) speed *= 0.6;
  const step = Math.min(speed, d - stopAt);
  const nx = dx / d;
  const ny = dy / d;
  const tries: [number, number][] = [
    [nx, ny],
    [nx * 0.7 - ny * 0.7, ny * 0.7 + nx * 0.7],
    [nx * 0.7 + ny * 0.7, ny * 0.7 - nx * 0.7],
    [-ny, nx],
    [ny, -nx],
  ];
  const side = u.id % 2 === 0 ? 1 : 2;
  const order = side === 1 ? [0, 1, 2, 3, 4] : [0, 2, 1, 4, 3];
  for (const k of order) {
    const [vx, vy] = tries[k]!;
    const px = u.x + vx * step;
    const py = u.y + vy * step;
    if (passable(world.map, px, py)) {
      u.x = px;
      u.y = py;
      return;
    }
  }
}

export function step(world: World, inputs: readonly SimInput[]): TickEvents {
  const events: TickEvents = { attacks: [], deaths: [], spawns: [], captures: [] };
  const alive = countAlive(world);
  for (const input of inputs) applyInput(world, input, events, alive);

  for (const p of world.players) {
    const counts = alive.get(p.playerId) ?? [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      if (p.respawnAt[k] === 0 || world.tick < p.respawnAt[k]!) continue;
      p.respawnAt[k] = 0;
      const base = playerBase(world, p.faction);
      for (let n = counts[k]!; n < p.target[k]!; n++) {
        const u = spawnUnit(world, p.playerId, p.faction, k as UnitKind, base.x, base.y, base.radius * 0.8, rankMultiplier(p.rank));
        events.spawns.push({ unitId: u.id, playerId: p.playerId, kind: u.kind });
      }
    }
  }

  for (let f = 0; f < world.factions.length; f++) {
    if ((world.tick + f * 5) % COUNCIL_TICKS === 0) runCouncil(world, f);
  }

  const units = world.units;
  const hash = buildHash(world);
  const indexById = new Map<number, number>();
  units.forEach((u, i) => indexById.set(u.id, i));
  const playerById = new Map<number, PlayerState>();
  for (const p of world.players) playerById.set(p.playerId, p);
  const killer = new Int32Array(units.length).fill(NEUTRAL);
  const objectives = world.map.objectives;

  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    if (u.hp <= 0) continue;
    const stats = KIND_STATS[u.kind]!;
    if (u.cooldown > 0) u.cooldown--;

    let target: Unit | undefined;
    const ti = u.targetUnitId === -1 ? undefined : indexById.get(u.targetUnitId);
    if (ti !== undefined) {
      const t = units[ti]!;
      const dx = t.x - u.x;
      const dy = t.y - u.y;
      if (t.hp > 0 && dx * dx + dy * dy < stats.aggro * stats.aggro * 1.4) target = t;
    }
    if (!target) {
      let best = stats.aggro * stats.aggro;
      forEachNear(hash, u.x, u.y, stats.aggro, (j) => {
        const o = units[j]!;
        if (o.faction === u.faction || o.hp <= 0) return;
        const dx = o.x - u.x;
        const dy = o.y - u.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < best) {
          best = d2;
          target = o;
        }
      });
    }
    u.targetUnitId = target ? target.id : -1;

    if (target) {
      const dx = target.x - u.x;
      const dy = target.y - u.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= stats.range + 4) {
        if (u.cooldown === 0) {
          const ranged = u.kind === UnitKind.Archer;
          let dmg = stats.damage * (u.faction === NEUTRAL ? 1 : rankMultiplier(playerById.get(u.playerId)?.rank ?? 0));
          if (BEATS[u.kind] === target.kind) dmg *= 1.5;
          if (ranged && terrainAt(world.map, target.x, target.y) === Terrain.Forest) dmg *= 0.5;
          target.hp -= dmg;
          u.cooldown = stats.cooldown;
          events.attacks.push({ from: u.id, to: target.id, ranged });
          if (target.hp <= 0) killer[indexById.get(target.id)!] = u.playerId;
        }
        if (u.kind === UnitKind.Archer && d < stats.range * 0.6) moveToward(world, u, u.x - dx, u.y - dy, 0);
      } else if (u.faction !== NEUTRAL || d < stats.aggro) {
        moveToward(world, u, target.x, target.y, stats.range * 0.8);
      }
    } else if (u.faction === NEUTRAL) {
      let home = objectives[0]!;
      let bd = Infinity;
      for (const o of objectives) {
        const d = (o.x - u.x) * (o.x - u.x) + (o.y - u.y) * (o.y - u.y);
        if (d < bd) {
          bd = d;
          home = o;
        }
      }
      moveToward(world, u, home.x, home.y, home.radius * 0.6);
    } else {
      const orderId = playerById.get(u.playerId)?.orderObjectiveId ?? -1;
      const dest = orderId >= 0 ? objectives[orderId]! : playerBase(world, u.faction);
      const jx = (((u.id * 7919) % 97) / 97 - 0.5) * dest.radius * 1.4;
      const jy = (((u.id * 104729) % 89) / 89 - 0.5) * dest.radius * 1.4;
      moveToward(world, u, dest.x + jx, dest.y + jy, 6);
    }

    let pushes = 0;
    forEachNear(hash, u.x, u.y, 7, (j) => {
      if (j === i || pushes > 6) return;
      const o = units[j]!;
      const dx = u.x - o.x;
      const dy = u.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 0.01 && d2 < 36) {
        const d = Math.sqrt(d2);
        const px = u.x + (dx / d) * 0.6;
        const py = u.y + (dy / d) * 0.6;
        if (passable(world.map, px, py)) {
          u.x = px;
          u.y = py;
        }
        pushes++;
      }
    });
  }

  const survivors: Unit[] = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    if (u.hp > 0) {
      survivors.push(u);
      continue;
    }
    const killerPlayerId = killer[i]!;
    events.deaths.push({ unitId: u.id, x: u.x, y: u.y, faction: u.faction, kind: u.kind, playerId: u.playerId, killerPlayerId });
    const victim = playerById.get(u.playerId);
    if (victim) {
      victim.losses++;
      const counts = alive.get(victim.playerId) ?? [0, 0, 0];
      counts[u.kind]!--;
      if (counts[u.kind]! < victim.target[u.kind]! && victim.respawnAt[u.kind] === 0) victim.respawnAt[u.kind] = world.tick + RESPAWN_TICKS;
    }
    const k = playerById.get(killerPlayerId);
    if (k) k.kills++;
  }
  world.units = survivors;

  updateObjectives(world, events, playerById);
  if (world.tick % 5 === 0) updateTerritory(world);
  if (world.tick % 10 === 0) score(world);
  world.tick++;
  return events;
}

function updateObjectives(world: World, events: TickEvents, playerById: Map<number, PlayerState>): void {
  const hash = buildHash(world);
  for (const def of world.map.objectives) {
    if (def.kind === 'base') continue;
    const state = world.objectives[def.id]!;
    const present = new Map<number, number[]>();
    forEachNear(hash, def.x, def.y, def.radius, (j) => {
      const u = world.units[j]!;
      if ((u.x - def.x) * (u.x - def.x) + (u.y - def.y) * (u.y - def.y) > def.radius * def.radius) return;
      let list = present.get(u.faction);
      if (!list) present.set(u.faction, (list = []));
      if (!list.includes(u.playerId)) list.push(u.playerId);
    });
    const factions = [...present.keys()].sort((a, b) => a - b);
    if (factions.length === 1 && factions[0] !== state.owner && factions[0] !== NEUTRAL) {
      const f = factions[0]!;
      if (state.capturer !== f) {
        state.capturer = f;
        state.progress = 0;
      }
      state.progress = Math.min(1, state.progress + 1 / CAPTURE_TICKS);
      if (state.progress >= 1) {
        const previous = state.owner;
        state.owner = f;
        state.capturer = NEUTRAL;
        state.progress = 0;
        const playerIds = (present.get(f) ?? []).slice().sort((a, b) => a - b);
        for (const id of playerIds) {
          const p = playerById.get(id);
          if (p) p.captures++;
        }
        events.captures.push({ objectiveId: def.id, faction: f, previous, playerIds });
      }
    } else if (factions.length === 0 || (factions.length === 1 && factions[0] === state.owner)) {
      state.progress = Math.max(0, state.progress - 1 / (CAPTURE_TICKS * 2));
      if (state.progress === 0) state.capturer = NEUTRAL;
    }
  }
}

function updateTerritory(world: World): void {
  const hash = buildHash(world);
  const { hexes, hexSize, objectives } = world.map;
  const reach = hexSize * 1.25;
  for (let i = 0; i < hexes.length; i++) {
    const h = hexes[i]!;
    let only = -2;
    forEachNear(hash, h.x, h.y, reach, (j) => {
      const u = world.units[j]!;
      if (u.faction === NEUTRAL || only === -3) return;
      if ((u.x - h.x) * (u.x - h.x) + (u.y - h.y) * (u.y - h.y) > reach * reach) return;
      if (only === -2) only = u.faction;
      else if (only !== u.faction) only = -3;
    });
    if (only >= 0) {
      world.territory[i] = only;
      continue;
    }
    if (only === -3) continue;
    for (const o of objectives) {
      const owner = world.objectives[o.id]!.owner;
      if (owner === NEUTRAL) continue;
      if ((o.x - h.x) * (o.x - h.x) + (o.y - h.y) * (o.y - h.y) < (o.radius + hexSize * 1.8) * (o.radius + hexSize * 1.8)) {
        world.territory[i] = owner;
        break;
      }
    }
  }
}

function score(world: World): void {
  for (const f of world.factions) {
    f.hexesHeld = 0;
    f.objectivesHeld = 0;
  }
  for (let i = 0; i < world.territory.length; i++) {
    const owner = world.territory[i]!;
    if (owner >= 0 && owner < world.factions.length) world.factions[owner]!.hexesHeld++;
  }
  let dominant = -2;
  for (const def of world.map.objectives) {
    if (def.kind === 'base') continue;
    const owner = world.objectives[def.id]!.owner;
    if (owner >= 0) {
      const f = world.factions[owner]!;
      f.objectivesHeld++;
      f.score += def.pointsPerSecond;
    }
    if (dominant === -2) dominant = owner;
    else if (dominant !== owner) dominant = -3;
  }
  for (const f of world.factions) f.score += f.hexesHeld / 10;
  if (dominant >= 0) {
    if (world.dominationFaction !== dominant) {
      world.dominationFaction = dominant;
      world.dominationSince = world.tick;
    } else if (world.tick - world.dominationSince >= DOMINATION_TICKS && world.winner === NEUTRAL) {
      world.winner = dominant;
    }
  } else {
    world.dominationFaction = NEUTRAL;
  }
}

interface SerializedWorld extends Omit<World, 'map' | 'territory'> {
  map: Omit<MapDef, 'terrain'> & { terrain: number[] };
  territory: number[];
}

export function snapshot(world: World): WorldSnapshot {
  const serialized: SerializedWorld = {
    ...world,
    map: { ...world.map, terrain: Array.from(world.map.terrain) },
    territory: Array.from(world.territory),
  };
  return { version: 1, world: structuredClone(serialized) };
}

export function restore(snap: WorldSnapshot): World {
  const s = structuredClone(snap.world) as SerializedWorld;
  return { ...s, map: { ...s.map, terrain: Uint8Array.from(s.map.terrain) }, territory: Int8Array.from(s.territory) };
}

export function checksum(world: World): number {
  let h = 2166136261 ^ world.tick;
  const mix = (v: number) => {
    h = Math.imul(h ^ (v | 0), 16777619);
  };
  mix(world.units.length);
  for (const u of world.units) {
    mix(u.id);
    mix(u.x * 64);
    mix(u.y * 64);
    mix(u.hp * 16);
  }
  for (const f of world.factions) mix(f.score * 10);
  for (let i = 0; i < world.territory.length; i++) mix(world.territory[i]!);
  return h >>> 0;
}
