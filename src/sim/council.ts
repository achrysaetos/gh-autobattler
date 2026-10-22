import { UnitKind, type World } from './api.ts';
import { derived } from './derived.ts';
import { cellAt } from './flowfield.ts';
import type { Scratch } from './scratch.ts';
import { STATS } from './stats.ts';

const INFLUENCE_CELL = 128;
const RETREAT_RATIO = 1.6;
const RALLY_RATIO = 1.0;
const OBJECTIVE_BONUS = 3;
const IDLE_HOLD_VALUE = 0.15;
const DEFEND_VALUE = 1.6;
const SPREAD_PENALTY = 0.6;
const DISTANCE_SCALE = 500;
const HYSTERESIS = 1.3;

function strengthOf(kind: UnitKind, hp: number): number {
  return hp * STATS[kind]!.strength;
}

// One faction's war council: every warband (a player's units) gets an objective.
// Warbands are planned strongest first so later ones see where earlier ones went.
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

  const gridCell = (x: number, y: number) => {
    const gx = Math.min(gc - 1, Math.max(0, Math.floor((x - map.originX) / INFLUENCE_CELL)));
    const gy = Math.min(gc - 1, Math.max(0, Math.floor((y - map.originY) / INFLUENCE_CELL)));
    return gy * gc + gx;
  };
  const around = (x: number, y: number, own: boolean) => {
    const gx = Math.min(gc - 1, Math.max(0, Math.floor((x - map.originX) / INFLUENCE_CELL)));
    const gy = Math.min(gc - 1, Math.max(0, Math.floor((y - map.originY) / INFLUENCE_CELL)));
    let total = 0;
    for (let yy = Math.max(0, gy - 1); yy <= Math.min(gc - 1, gy + 1); yy++) {
      for (let xx = Math.max(0, gx - 1); xx <= Math.min(gc - 1, gx + 1); xx++) {
        const base = (yy * gc + xx) * slots;
        if (own) total += grid[base + faction]!;
        else for (let k = 0; k < slots; k++) if (k !== faction) total += grid[base + k]!;
      }
    }
    return total;
  };

  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    const w = strengthOf(u.kind, u.hp);
    grid[gridCell(u.x, u.y) * slots + (u.faction < 0 ? neutralSlot : u.faction)]! += w;
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
  const plannedStr = new Float64Array(objectives.length);
  const plannedCount = new Int32Array(objectives.length);

  const order: number[] = [];
  for (let p = 0; p < np; p++) if (players[p]!.faction === faction && count[p]! > 0) order.push(p);
  order.sort((a, b) => str[b]! - str[a]! || a - b);

  for (const p of order) {
    const player = players[p]!;
    const cx = sumX[p]! / count[p]!;
    const cy = sumY[p]! / count[p]!;
    let cell = cellAt(map, cx, cy);
    if (cell < 0 || d.flow[0]!.cost[cell]! < 0) cell = anchorCell[p]!;
    const strength = str[p]!;
    const localEnemy = around(cx, cy, false);
    const localFriend = around(cx, cy, true);
    const threshold = player.retreating ? RALLY_RATIO : RETREAT_RATIO;

    if (localEnemy > 0 && localEnemy > threshold * localFriend) {
      let best = -1;
      let bestCost = Infinity;
      for (let o = 0; o < objectives.length; o++) {
        if (objectives[o]!.owner !== faction) continue;
        const c = d.flow[o]!.cost[cell]!;
        if (c >= 0 && c < bestCost && enemyNear[o]! <= friendNear[o]! + strength) {
          bestCost = c;
          best = o;
        }
      }
      if (best >= 0) {
        player.retreating = true;
        player.orderObjectiveId = best;
        plannedStr[best]! += strength;
        plannedCount[best]!++;
        continue;
      }
    }
    player.retreating = false;

    let best = -1;
    let bestUtility = 0;
    const cavShare = cav[p]! / strength;
    for (let o = 0; o < objectives.length; o++) {
      const def = map.objectives[o]!;
      if (def.kind === 'base') continue;
      const c = d.flow[o]!.cost[cell]!;
      if (c < 0) continue;
      const dist = (c / 10) * map.navCell;
      const enemy = enemyNear[o]!;
      const owned = objectives[o]!.owner === faction;
      const points = def.pointsPerSecond + OBJECTIVE_BONUS;
      let value: number;
      if (owned) value = enemy > 0 ? points * DEFEND_VALUE : (points * IDLE_HOLD_VALUE) / (1 + plannedCount[o]!);
      else value = points;
      const ratio = (friendNear[o]! + plannedStr[o]! + strength) / (enemy + 1);
      const feasible = ratio >= 1.2 ? 1 : ratio < 0.5 ? 0.05 : (ratio - 0.4) / 0.8;
      const spread = 1 / (1 + SPREAD_PENALTY * plannedCount[o]!);
      const lightlyHeld = enemy < strength * 0.5;
      const cavalry = lightlyHeld ? 1 + 0.8 * cavShare : 1 - 0.4 * cavShare;
      let utility = (value * feasible * spread * cavalry) / (1 + dist / DISTANCE_SCALE);
      if (o === player.orderObjectiveId) utility *= HYSTERESIS;
      if (utility > bestUtility) {
        bestUtility = utility;
        best = o;
      }
    }
    if (best < 0) best = baseOf(world, faction);
    player.orderObjectiveId = best;
    plannedStr[best]! += strength;
    plannedCount[best]!++;
  }
}

export function baseOf(world: World, faction: number): number {
  const objectives = world.map.objectives;
  for (let o = 0; o < objectives.length; o++) {
    const def = objectives[o]!;
    if (def.kind === 'base' && def.homeFaction === faction) return o;
  }
  return 0;
}
