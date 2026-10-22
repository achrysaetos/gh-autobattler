import { NEUTRAL, type TickEvents, type World } from './api.ts';
import type { Scratch } from './scratch.ts';
import { bucketX, bucketY } from './spatial.ts';
import { DOMINATION_TICKS } from './stats.ts';

export const CAPTURE_FULL = 1500;
const CITADEL_FULL = 3000;
const MAX_CAPTURE_RATE = 10;
const IDLE_DECAY = 2;

// Progress counts up toward `capturer` while only that faction stands inside the
// radius; a lone owner or a rival first has to wind it back down to zero.
export function updateCaptures(world: World, s: Scratch, ev: TickEvents): void {
  const { units, map, objectives } = world;
  const hash = s.hash;
  const counts = new Int32Array(world.factions.length);
  for (let o = 0; o < objectives.length; o++) {
    const def = map.objectives[o]!;
    if (def.kind === 'base') continue;
    const state = objectives[o]!;
    counts.fill(0);
    let neutral = 0;
    let present = -1;
    let factionsPresent = 0;
    const r2 = def.radius * def.radius;
    for (let y = bucketY(hash, def.y - def.radius); y <= bucketY(hash, def.y + def.radius); y++) {
      for (let x = bucketX(hash, def.x - def.radius); x <= bucketX(hash, def.x + def.radius); x++) {
        for (let j = hash.head[y * hash.cols + x]!; j >= 0; j = hash.next[j]!) {
          const u = units[j]!;
          const dx = u.x - def.x;
          const dy = u.y - def.y;
          if (dx * dx + dy * dy > r2) continue;
          if (u.faction === NEUTRAL) neutral++;
          else {
            if (counts[u.faction] === 0) {
              factionsPresent++;
              present = u.faction;
            }
            counts[u.faction]!++;
          }
        }
      }
    }
    if (neutral > 0 || factionsPresent > 1) continue;
    if (factionsPresent === 0) {
      state.progress = Math.max(0, state.progress - IDLE_DECAY);
      if (state.progress === 0) state.capturer = NEUTRAL;
      continue;
    }
    const rate = Math.min(MAX_CAPTURE_RATE, counts[present]!);
    if (present === state.owner || (state.capturer !== NEUTRAL && state.capturer !== present)) {
      state.progress = Math.max(0, state.progress - rate);
      if (state.progress === 0) state.capturer = present === state.owner ? NEUTRAL : present;
      continue;
    }
    state.capturer = present;
    state.progress += rate;
    if (state.progress < (def.kind === 'citadel' ? CITADEL_FULL : CAPTURE_FULL)) continue;
    const previous = state.owner;
    state.owner = present;
    state.capturer = NEUTRAL;
    state.progress = 0;
    ev.captures.push({ objectiveId: o, faction: present, previous, playerIds: capturers(world, s, o, present) });
  }
}

function capturers(world: World, s: Scratch, o: number, faction: number): number[] {
  const def = world.map.objectives[o]!;
  const r2 = def.radius * def.radius;
  const ids: number[] = [];
  const credited = new Uint8Array(world.players.length);
  for (let i = 0; i < world.units.length; i++) {
    const u = world.units[i]!;
    if (u.faction !== faction) continue;
    const dx = u.x - def.x;
    const dy = u.y - def.y;
    if (dx * dx + dy * dy > r2) continue;
    const p = s.unitPlayer[i]!;
    if (p < 0 || credited[p]) continue;
    credited[p] = 1;
    ids.push(u.playerId);
    world.players[p]!.captures++;
  }
  return ids;
}

export function updateDomination(world: World): void {
  let holder = NEUTRAL;
  for (let o = 0; o < world.objectives.length; o++) {
    if (world.map.objectives[o]!.kind === 'base') continue;
    const owner = world.objectives[o]!.owner;
    if (owner === NEUTRAL || (holder !== NEUTRAL && owner !== holder)) {
      holder = NEUTRAL;
      break;
    }
    holder = owner;
  }
  if (holder !== world.dominationFaction) {
    world.dominationFaction = holder;
    world.dominationSince = holder === NEUTRAL ? -1 : world.tick;
  }
  if (holder !== NEUTRAL && world.winner === NEUTRAL && world.tick - world.dominationSince >= DOMINATION_TICKS) {
    world.winner = holder;
  }
}
