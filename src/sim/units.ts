import { NEUTRAL, Terrain, type TickEvents, type Unit, type World } from './api.ts';
import { findTarget, isScreened } from './combat.ts';
import { derived } from './derived.ts';
import { cellAt } from './flowfield.ts';
import type { Scratch } from './scratch.ts';
import { FOREST_SPEED, STATS, hitDamage } from './stats.ts';
import { flowDirection, resolveMove, separation, towards, type Vec } from './steering.ts';

const LEASH = 1.3;
const RETARGET_IDLE = 3;
const RETARGET_ENGAGED = 10;
const KITE_DISTANCE = 0.55;
const ARCHER_APPROACH = 0.92;
const UNSCREENED_PACE = 0.45;
const MELEE_HOLD = 0.75;
const HOLD_FRACTION = 0.55;
const NEUTRAL_LEASH = 140;

const dir: Vec = { x: 0, y: 0 };
const push: Vec = { x: 0, y: 0 };
const moved: Vec = { x: 0, y: 0 };

// Decide, strike, and steer every unit against start-of-tick positions. Damage and
// new positions land in scratch buffers so index order never favors anyone.
export function updateUnits(world: World, s: Scratch, ev: TickEvents): void {
  const { units, players, map, tick } = world;
  const d = derived(map);
  const hash = s.hash;
  s.damage.fill(0, 0, units.length);
  s.killer.fill(NEUTRAL, 0, units.length);

  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    const stats = STATS[u.kind]!;
    const p = s.unitPlayer[i]!;
    const player = p >= 0 ? players[p]! : undefined;
    const retreating = player !== undefined && player.retreating;
    const aggro = retreating ? stats.range + 4 : stats.aggro;
    const home = player === undefined ? nearestObjective(world, u) : -1;

    let t = u.targetUnitId >= 0 ? (s.idToIndex.get(u.targetUnitId) ?? -1) : -1;
    if (t >= 0 && dist2(u, units[t]!) > aggro * aggro * LEASH * LEASH) t = -1;
    const phase = tick + u.id;
    if ((t < 0 && phase % RETARGET_IDLE === 0) || (t >= 0 && phase % RETARGET_ENGAGED === 0)) {
      const found = findTarget(units, hash, i, aggro);
      if (found >= 0) t = found;
    }
    if (t >= 0 && home >= 0) {
      const o = map.objectives[home]!;
      const v = units[t]!;
      const dx = v.x - o.x;
      const dy = v.y - o.y;
      const reach = o.radius + NEUTRAL_LEASH;
      if (dx * dx + dy * dy > reach * reach) t = -1;
    }
    u.targetUnitId = t >= 0 ? units[t]!.id : -1;
    if (u.cooldown > 0) u.cooldown--;

    let pace = 1;
    let moving = true;
    if (t >= 0) {
      const v = units[t]!;
      const dist = towards(dir, u.x, u.y, v.x, v.y);
      if (dist <= stats.range && u.cooldown === 0) {
        const cell = cellAt(map, v.x, v.y);
        const inForest = cell >= 0 && map.terrain[cell] === Terrain.Forest;
        s.damage[t]! += hitDamage(u.kind, player ? player.rank : 0, v.kind, inForest);
        s.killer[t] = u.playerId;
        u.cooldown = stats.cooldown;
        ev.attacks.push({ from: u.id, to: v.id, ranged: stats.ranged });
      }
      if (retreating) {
        const o = map.objectives[player!.orderObjectiveId]!;
        flowDirection(dir, map, d.flow[o.id]!, u.x, u.y, o.x, o.y);
      } else if (stats.ranged) {
        if (dist < stats.range * KITE_DISTANCE && !STATS[v.kind]!.ranged) {
          dir.x = -dir.x;
          dir.y = -dir.y;
        } else if (dist > stats.range * ARCHER_APPROACH) {
          if (!isScreened(units, hash, i, v)) pace = UNSCREENED_PACE;
        } else moving = false;
      } else if (dist <= stats.range * MELEE_HOLD) moving = false;
    } else {
      const objective = home >= 0 ? home : player!.orderObjectiveId;
      const o = map.objectives[objective]!;
      const dx = o.x - u.x;
      const dy = o.y - u.y;
      const holdRadius = o.radius * HOLD_FRACTION;
      if (dx * dx + dy * dy <= holdRadius * holdRadius) moving = false;
      else flowDirection(dir, map, d.flow[objective]!, u.x, u.y, o.x, o.y);
    }

    const cell = cellAt(map, u.x, u.y);
    const speed = stats.speed * (cell >= 0 && map.terrain[cell] === Terrain.Forest ? FOREST_SPEED : 1);
    separation(push, units, hash, i);
    let vx = push.x;
    let vy = push.y;
    if (moving) {
      vx += dir.x * speed * pace;
      vy += dir.y * speed * pace;
    }
    resolveMove(moved, map, u.x, u.y, vx, vy, speed);
    s.nx[i] = moved.x;
    s.ny[i] = moved.y;
  }
}

function dist2(a: Unit, b: Unit): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function nearestObjective(world: World, u: Unit): number {
  let best = -1;
  let bestD = Infinity;
  const objectives = world.map.objectives;
  for (let o = 0; o < objectives.length; o++) {
    const def = objectives[o]!;
    if (def.kind === 'base') continue;
    const dx = def.x - u.x;
    const dy = def.y - u.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD) {
      bestD = d2;
      best = o;
    }
  }
  return best;
}
