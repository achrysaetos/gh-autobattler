import { NEUTRAL, Terrain, type SimInput, type UnitKind, type World } from './api.ts';
import { createWorld, generateMap, step } from './index.ts';
import { DOMINATION_TICKS } from './stats.ts';

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
  const params = { seed, factionCount: armies.length, expectedUnits, dominationTicks: DOMINATION_TICKS };
  return { world: createWorld(params, generateMap(params)), inputs: enlistAll(armies) };
}

export function run(world: World, ticks: number, firstInputs: readonly SimInput[] = []): void {
  for (let t = 0; t < ticks; t++) step(world, t === 0 ? firstInputs : []);
}

export function arenaWorld(seed: number, factionCount: number): World {
  const params = { seed, factionCount, expectedUnits: 40, dominationTicks: DOMINATION_TICKS };
  const map = generateMap(params);
  for (let i = 0; i < map.terrain.length; i++) if (map.terrain[i] !== Terrain.Void) map.terrain[i] = Terrain.Plain;
  const world = createWorld(params, map);
  world.units = world.units.filter((u) => u.faction !== NEUTRAL);
  return world;
}

export function aliveOf(world: World, playerId: number, kind?: UnitKind): number {
  return world.units.filter((u) => u.playerId === playerId && (kind === undefined || u.kind === kind)).length;
}

export interface DuelResult {
  ticks: number;
  survivors: [number, number];
  kills: [number, number];
}

export function duel(a: UnitKind, b: UnitKind, seed = 1, size = 10): DuelResult {
  const world = arenaWorld(seed, 2);
  const kinds = [a, b];
  for (let side = 0; side < 2; side++) {
    const counts = [0, 0, 0];
    counts[kinds[side]!] = size;
    step(world, [
      { kind: 'enlist', playerId: side + 1, faction: side },
      { kind: 'muster', playerId: side + 1, infantry: counts[0]!, archers: counts[1]!, cavalry: counts[2]!, rank: 0 },
    ]);
  }
  for (const u of world.units) {
    const side = u.faction;
    const slot = world.units.filter((v) => v.faction === side && v.id < u.id).length;
    u.x = (side === 0 ? -70 : 70) + (slot % 2) * (side === 0 ? -12 : 12);
    u.y = (Math.floor(slot / 2) - 2) * 12;
  }
  const onField = (f: number) =>
    world.units.filter((u) => u.faction === f && u.bornTick < 2 && u.x * u.x + u.y * u.y < 400 * 400).length;
  let ticks = 0;
  while (ticks < 190 && onField(0) > 0 && onField(1) > 0) {
    step(world, []);
    ticks++;
  }
  const kills = world.players.map((p) => p.kills) as [number, number];
  return { ticks, survivors: [onField(0), onField(1)], kills };
}
