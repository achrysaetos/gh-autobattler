import { NEUTRAL, type World } from './api.ts';
import { derived } from './derived.ts';
import { hexIndexAt } from './hex.ts';
import { nextRandom } from './rng.ts';

const NEUTRAL_BIT = 1 << 8;
const DRIFT_CHANCE = 0.25;

export function updateTerritory(world: World): void {
  const d = derived(world.map);
  const presence = new Uint16Array(world.map.hexes.length);
  for (const u of world.units) {
    const h = hexIndexAt(d.hexLookup, u.x, u.y);
    if (h >= 0) presence[h]! |= u.faction === NEUTRAL ? NEUTRAL_BIT : 1 << u.faction;
  }
  const { territory, objectives } = world;
  for (let h = 0; h < presence.length; h++) {
    const mask = presence[h]!;
    if (mask === 0) {
      const anchor = d.hexAnchor[h]!;
      if (anchor < 0) continue;
      const owner = objectives[anchor]!.owner;
      if (owner === NEUTRAL || territory[h] === owner) continue;
      if (nextRandom(world) < DRIFT_CHANCE) territory[h] = owner;
    } else if ((mask & (mask - 1)) === 0 && mask !== NEUTRAL_BIT) {
      territory[h] = singleBit(mask);
    }
  }
}

function singleBit(mask: number): number {
  let f = 0;
  while (mask > 1) {
    mask >>= 1;
    f++;
  }
  return f;
}

export function scoreSecond(world: World): void {
  const { factions, territory, objectives, map } = world;
  for (const f of factions) {
    f.hexesHeld = 0;
    f.objectivesHeld = 0;
  }
  for (let h = 0; h < territory.length; h++) {
    const owner = territory[h]!;
    if (owner >= 0) factions[owner]!.hexesHeld++;
  }
  for (const f of factions) f.score += f.hexesHeld / 10;
  for (let o = 0; o < objectives.length; o++) {
    const owner = objectives[o]!.owner;
    const def = map.objectives[o]!;
    if (owner < 0 || def.kind === 'base') continue;
    factions[owner]!.objectivesHeld++;
    factions[owner]!.score += def.pointsPerSecond;
  }
}
