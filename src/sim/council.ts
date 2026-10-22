import { UnitKind, type World } from './api.ts';
import { captureFull } from './capture.ts';
import { derived } from './derived.ts';
import { cellAt } from './flowfield.ts';
import type { Scratch } from './scratch.ts';
import { STATS } from './stats.ts';

const INFLUENCE_CELL = 128;
const RETREAT_RATIO = 1.6;
const RALLY_RATIO = 1.0;
const OBJECTIVE_BONUS = 3;
const DISTANCE_SCALE = 500;
const COVER_RATIO = 1.5;
// Garrisons never reinforce, so they need a smaller safety margin than armies.
const GARRISON_COVER_RATIO = 1.1;
const CAPTURE_FORCE = 600;
const CAPTURE_MOMENTUM = 3;
const STAY_DISCOUNT = 0.5;
const ACTIVE_FRONT_BONUS = 1.3;
const REINFORCE_CAP = 2;

interface Warband {
  player: number;
  cell: number;
  strength: number;
  cavShare: number;
}

interface Front {
  objective: number;
  value: number;
  need: number;
  enemy: number;
  assigned: number;
  members: number;
}

function strengthOf(kind: UnitKind, hp: number): number {
  return hp * STATS[kind]!.strength;
}

// A faction's war council. Warbands facing overwhelming odds fall back; the rest
// are pooled into fronts, each contested objective sized to beat the strength
// around it. Fronts are filled one at a time, nearest warbands first,
// so attacks go in as coalitions big enough to win instead of piecemeal.
export function runCouncil(world: World, s: Scratch, faction: number): void {
  const { map, units, players, objectives } = world;
  const d = derived(map);
  const slots = world.factions.length + 1;
  const neutralSlot = slots - 1;
  const gc = Math.floor((map.navCols * map.navCell) / INFLUENCE_CELL) + 1;
  const grid = new Float64Array(gc * gc * slots);
  const np = players.length;
  const sumX = new Float64Array(np);
  const sumY = new Float64Array(np);
  const str = new Float64Array(np);
  const cav = new Float64Array(np);
  const count = new Int32Array(np);
  const anchorCell = new Int32Array(np).fill(-1);

  const gridIndex = (x: number, y: number) => {
    const gx = Math.min(gc - 1, Math.max(0, Math.floor((x - map.originX) / INFLUENCE_CELL)));
    const gy = Math.min(gc - 1, Math.max(0, Math.floor((y - map.originY) / INFLUENCE_CELL)));
    return gy * gc + gx;
  };
  const around = (x: number, y: number, own: boolean, onlyNeutral = false) => {
    const g = gridIndex(x, y);
    const gx = g % gc;
    const gy = (g - gx) / gc;
    let total = 0;
    for (let yy = Math.max(0, gy - 1); yy <= Math.min(gc - 1, gy + 1); yy++) {
      for (let xx = Math.max(0, gx - 1); xx <= Math.min(gc - 1, gx + 1); xx++) {
        const base = (yy * gc + xx) * slots;
        if (own) total += grid[base + faction]!;
        else if (onlyNeutral) total += grid[base + neutralSlot]!;
        else for (let k = 0; k < slots; k++) if (k !== faction) total += grid[base + k]!;
      }
    }
    return total;
  };

  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    const w = strengthOf(u.kind, u.hp);
    grid[gridIndex(u.x, u.y) * slots + (u.faction < 0 ? neutralSlot : u.faction)]! += w;
    const p = s.unitPlayer[i]!;
    if (p < 0 || players[p]!.faction !== faction) continue;
    sumX[p]! += u.x;
    sumY[p]! += u.y;
    str[p]! += w;
    if (u.kind === UnitKind.Cavalry) cav[p]! += w;
    if (count[p] === 0) anchorCell[p] = cellAt(map, u.x, u.y);
    count[p]!++;
  }

  const enemyNear = objectives.map((_, o) => around(map.objectives[o]!.x, map.objectives[o]!.y, false));
  const friendNear = objectives.map((_, o) => around(map.objectives[o]!.x, map.objectives[o]!.y, true));
  const neutralNear = objectives.map((_, o) => around(map.objectives[o]!.x, map.objectives[o]!.y, false, true));

  const free: Warband[] = [];
  for (let p = 0; p < np; p++) {
    if (players[p]!.faction !== faction || count[p] === 0) continue;
    const x = sumX[p]! / count[p]!;
    const y = sumY[p]! / count[p]!;
    let cell = cellAt(map, x, y);
    if (cell < 0 || d.flow[0]!.cost[cell]! < 0) cell = anchorCell[p]!;
    const band: Warband = { player: p, cell, strength: str[p]!, cavShare: cav[p]! / str[p]! };
    if (!fallBack(world, band, faction, around(x, y, false), around(x, y, true), enemyNear, friendNear)) free.push(band);
  }

  const fronts: Front[] = [];
  for (let o = 0; o < objectives.length; o++) {
    const def = map.objectives[o]!;
    if (def.kind === 'base') continue;
    const state = objectives[o]!;
    const enemy = enemyNear[o]!;
    if (state.owner === faction && enemy <= 0) continue;
    let value = def.pointsPerSecond + OBJECTIVE_BONUS;
    if (state.owner !== faction && state.capturer === faction) value *= 1 + (CAPTURE_MOMENTUM * state.progress) / captureFull(def.kind);
    const garrison = neutralNear[o]!;
    const need = Math.max(CAPTURE_FORCE, (enemy - garrison) * COVER_RATIO + garrison * GARRISON_COVER_RATIO);
    fronts.push({ objective: o, value, need, enemy, assigned: 0, members: 0 });
  }

  const pathTo = (band: Warband, o: number) => {
    const c = d.flow[o]!.cost[band.cell]!;
    const dist = c < 0 ? Infinity : (c / 10) * map.navCell;
    return players[band.player]!.orderObjectiveId === o ? dist * STAY_DISCOUNT : dist;
  };

  let available = free.reduce((sum, b) => sum + b.strength, 0);
  const assign = (band: Warband, front: Front) => {
    players[band.player]!.orderObjectiveId = front.objective;
    front.assigned += band.strength;
    front.members++;
    available -= band.strength;
    free.splice(free.indexOf(band), 1);
  };

  // Warbands finish what they started: a still-winnable front keeps its members.
  const total = available;
  for (const band of free.slice()) {
    const front = fronts.find((f) => f.objective === players[band.player]!.orderObjectiveId);
    if (front && front.need <= total && front.assigned < front.need * REINFORCE_CAP) assign(band, front);
  }

  for (;;) {
    let best: Front | undefined;
    let bestPriority = 0;
    for (const f of fronts) {
      if (f.assigned >= f.need || available + f.assigned < f.need) continue;
      const priority = frontPriority(f, free, pathTo, players);
      if (priority > bestPriority) {
        bestPriority = priority;
        best = f;
      }
    }
    if (!best) break;
    const front = best;
    const light = front.enemy < front.need * 0.5;
    const ranked = free.slice().sort((a, b) => fillCost(a, front, light, pathTo) - fillCost(b, front, light, pathTo) || a.player - b.player);
    for (const band of ranked) {
      if (front.assigned >= front.need) break;
      if (pathTo(band, front.objective) === Infinity) continue;
      assign(band, front);
    }
  }

  // Leftovers reinforce the most valuable reachable front, or, when nothing is
  // contested, post along the frontier so the faction holds a line, not a camp.
  const posted = new Int32Array(objectives.length);
  for (const f of fronts) posted[f.objective] = f.members;
  const frontCost = objectives.map((_, o) => nearestEnemyBase(world, faction, o));
  for (const band of free.slice()) {
    let target = -1;
    let bestScore = 0;
    for (const f of fronts) {
      const dist = pathTo(band, f.objective);
      if (dist === Infinity || f.assigned >= f.need * REINFORCE_CAP) continue;
      const score = f.value / (1 + f.members) / (1 + dist / DISTANCE_SCALE);
      if (score > bestScore) {
        bestScore = score;
        target = f.objective;
      }
    }
    const front = fronts.find((f) => f.objective === target);
    if (front) {
      assign(band, front);
      continue;
    }
    target = frontier(world, band, faction, posted, frontCost);
    posted[target]!++;
    players[band.player]!.orderObjectiveId = target;
  }
}

function frontPriority(
  f: Front,
  free: readonly Warband[],
  pathTo: (b: Warband, o: number) => number,
  players: World['players'],
): number {
  const o = f.objective;
  let nearest = Infinity;
  for (const b of free) nearest = Math.min(nearest, pathTo(b, o));
  if (nearest === Infinity) return 0;
  const active = free.some((b) => players[b.player]!.orderObjectiveId === o) ? ACTIVE_FRONT_BONUS : 1;
  return ((f.value / (f.need / CAPTURE_FORCE)) * active) / (1 + nearest / DISTANCE_SCALE);
}

function fillCost(band: Warband, front: Front, light: boolean, pathTo: (b: Warband, o: number) => number): number {
  const cavalry = light ? 1 - 0.5 * band.cavShare : 1 + 0.5 * band.cavShare;
  return pathTo(band, front.objective) * cavalry;
}

function fallBack(
  world: World,
  band: Warband,
  faction: number,
  localEnemy: number,
  localFriend: number,
  enemyNear: readonly number[],
  friendNear: readonly number[],
): boolean {
  const player = world.players[band.player]!;
  const threshold = player.retreating ? RALLY_RATIO : RETREAT_RATIO;
  if (localEnemy <= 0 || localEnemy <= threshold * localFriend) {
    player.retreating = false;
    return false;
  }
  const flow = derived(world.map).flow;
  let best = -1;
  let bestCost = Infinity;
  for (let o = 0; o < world.objectives.length; o++) {
    if (world.objectives[o]!.owner !== faction) continue;
    const c = flow[o]!.cost[band.cell]!;
    if (c >= 0 && c < bestCost && enemyNear[o]! <= friendNear[o]! + band.strength) {
      bestCost = c;
      best = o;
    }
  }
  player.retreating = best >= 0;
  if (best >= 0) player.orderObjectiveId = best;
  return best >= 0;
}

function nearestEnemyBase(world: World, faction: number, o: number): number {
  const { map } = world;
  const flow = derived(map).flow;
  const cell = cellAt(map, map.objectives[o]!.x, map.objectives[o]!.y);
  let best = Infinity;
  for (const base of map.objectives) {
    if (base.kind !== 'base' || base.homeFaction === faction) continue;
    const c = flow[base.id]!.cost[cell]!;
    if (c >= 0) best = Math.min(best, (c / 10) * map.navCell);
  }
  return best;
}

function frontier(world: World, band: Warband, faction: number, posted: Int32Array, frontCost: readonly number[]): number {
  const { map } = world;
  const flow = derived(map).flow;
  let best = baseOf(world, faction);
  let bestScore = 0;
  for (const def of map.objectives) {
    if (def.kind === 'base') continue;
    const c = flow[def.id]!.cost[band.cell]!;
    if (c < 0) continue;
    const toEnemy = frontCost[def.id]! === Infinity ? 0 : frontCost[def.id]!;
    const score = 1 / (1 + toEnemy / DISTANCE_SCALE) / (1 + posted[def.id]!) / (1 + (c / 10) * map.navCell / DISTANCE_SCALE);
    if (score > bestScore) {
      bestScore = score;
      best = def.id;
    }
  }
  return best;
}

export function baseOf(world: World, faction: number): number {
  const objectives = world.map.objectives;
  for (let o = 0; o < objectives.length; o++) {
    const def = objectives[o]!;
    if (def.kind === 'base' && def.homeFaction === faction) return o;
  }
  return 0;
}
