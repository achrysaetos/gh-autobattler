import { NEUTRAL, type Unit, type World } from './api.ts';
import { createSpatialHash, rebuildSpatialHash, type SpatialHash } from './spatial.ts';
import { MAX_ALIVE } from './stats.ts';

export interface Scratch {
  hash: SpatialHash;
  idToIndex: Map<number, number>;
  playerIndex: Map<number, number>;
  unitPlayer: Int32Array;
  nx: Float64Array;
  ny: Float64Array;
  damage: Float64Array;
  lastHitBy: Int32Array;
}

const cache = new WeakMap<World, Scratch>();

export function scratchFor(world: World): Scratch {
  let s = cache.get(world);
  if (!s) {
    const cap = MAX_ALIVE + 1;
    s = {
      hash: createSpatialHash(world.map, cap),
      idToIndex: new Map(),
      playerIndex: new Map(),
      unitPlayer: new Int32Array(cap),
      nx: new Float64Array(cap),
      ny: new Float64Array(cap),
      damage: new Float64Array(cap),
      lastHitBy: new Int32Array(cap),
    };
    cache.set(world, s);
  }
  if (s.playerIndex.size !== world.players.length) {
    s.playerIndex.clear();
    for (let p = 0; p < world.players.length; p++) s.playerIndex.set(world.players[p]!.playerId, p);
  }
  return s;
}

export function indexUnits(world: World, s: Scratch): void {
  const { units } = world;
  s.idToIndex.clear();
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    s.idToIndex.set(u.id, i);
    s.unitPlayer[i] = ownerIndex(s, u);
  }
  rebuildSpatialHash(s.hash, units);
}

export function ownerIndex(s: Scratch, u: Unit): number {
  return u.faction === NEUTRAL ? -1 : (s.playerIndex.get(u.playerId) ?? -1);
}
