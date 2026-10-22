import { NEUTRAL, Terrain, type SimInput, type UnitKind, type World } from './api.ts';
import { createWorld, generateMap, step } from './index.ts';

export interface Army {
  infantry: number;
  archers: number;
  cavalry: number;
  rank?: number;
}

export function enlistAll(armies: readonly Army[][]): SimInput[] {
  const inputs: SimInput[] = [];
  let id = 1;
  for (let faction = 0; faction < armies.length; faction++) {
    for (const a of armies[faction]!) {
      const playerId = id++;
      inputs.push({ kind: 'enlist', playerId, faction });
      inputs.push({ kind: 'muster', playerId, infantry: a.infantry, archers: a.archers, cavalry: a.cavalry, rank: a.rank ?? 0 });
    }
  }
  return inputs;
}

export function battleWorld(seed: number, armies: readonly Army[][]): { world: World; inputs: SimInput[] } {
  const expectedUnits = armies.flat().reduce((n, a) => n + a.infantry + a.archers + a.cavalry, 0);
  const params = { seed, factionCount: armies.length, expectedUnits };
  return { world: createWorld(params, generateMap(params)), inputs: enlistAll(armies) };
}

export function run(world: World, ticks: number, firstInputs: readonly SimInput[] = []): void {
  for (let t = 0; t < ticks; t++) step(world, t === 0 ? firstInputs : []);
}

// An open field with no garrisons: a clean arena for isolated mechanics.
export function arenaWorld(seed: number, factionCount: number): World {
  const params = { seed, factionCount, expectedUnits: 40 };
  const map = generateMap(params);
  for (let i = 0; i < map.terrain.length; i++) if (map.terrain[i] !== Terrain.Void) map.terrain[i] = Terrain.Plain;
  const world = createWorld(params, map);
  world.units = world.units.filter((u) => u.faction !== NEUTRAL);
  return world;
}

export function aliveOf(world: World, playerId: number, kind?: UnitKind): number {
  return world.units.filter((u) => u.playerId === playerId && (kind === undefined || u.kind === kind)).length;
}
